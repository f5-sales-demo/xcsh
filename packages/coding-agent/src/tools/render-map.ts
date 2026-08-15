import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { getBlobsDir, prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { MAP_HEIGHT, MAP_WIDTH, type RenderedMap, renderMap } from "../map/render";
import {
	MAP_CONFIDENCES,
	MAP_PRECISIONS,
	MAP_RESOLUTIONS,
	type MapLocationV1,
	validateMapLocationV1,
} from "../map/types";
import { MediaIngestError, MediaIngestor } from "../media/ingest";
import { type MediaToolResultV1, publishMedia } from "../media/publish";
import renderMapDescription from "../prompts/tools/render-map.md" with { type: "text" };
import { BlobStore } from "../session/blob-store";
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

export type {
	MapConfidence,
	MapLocationSourceV1,
	MapLocationV1,
	MapPrecision,
	MapResolution,
} from "../map/types";

const sourceSchema = Type.Object(
	{
		url: Type.String(),
		sourceName: Type.String(),
		observedAt: Type.String(),
		claim: Type.String(),
	},
	{ additionalProperties: false },
);

const locationSchema = Type.Object(
	{
		id: Type.String(),
		label: Type.String(),
		longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
		latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
		precision: Type.Union(MAP_PRECISIONS.map(value => Type.Literal(value))),
		resolution: Type.Union(MAP_RESOLUTIONS.map(value => Type.Literal(value))),
		confidence: Type.Union(MAP_CONFIDENCES.map(value => Type.Literal(value))),
		sources: Type.Array(sourceSchema),
	},
	{ additionalProperties: false },
);

const renderMapSchema = Type.Object(
	{
		title: Type.String({ minLength: 1, maxLength: 256 }),
		locations: Type.Array(locationSchema, { minItems: 1, maxItems: 500 }),
		basemap: Type.Optional(Type.Union([Type.Literal("osm"), Type.Literal("schematic")], { default: "osm" })),
		savePath: Type.Optional(Type.String({ description: "Base path for explicit .png and .geojson export" })),
		overwrite: Type.Optional(Type.Boolean({ default: false })),
	},
	{ additionalProperties: false },
);

export type RenderMapParams = Static<typeof renderMapSchema>;

export interface RenderMapDependencies {
	render?: (request: {
		title: string;
		locations: MapLocationV1[];
		basemap: "osm" | "schematic";
		signal?: AbortSignal;
		settings?: { get(key: string): unknown };
	}) => Promise<RenderedMap>;
}

function evidenceText(title: string, locations: readonly MapLocationV1[], degradation?: string): string {
	const lines = [`${title} — location evidence`];
	locations.forEach((location, index) => {
		const coordinate =
			location.longitude === undefined
				? "unresolved; not plotted"
				: `${location.latitude!.toFixed(5)}, ${location.longitude.toFixed(5)}`;
		lines.push(
			`${index + 1}. ${location.label} [${location.precision}/${location.resolution}; ${location.confidence}] — ${coordinate}`,
		);
		for (const source of location.sources) {
			lines.push(`   ${source.sourceName} (${source.observedAt}): ${source.claim} ${source.url}`);
		}
	});
	if (degradation) lines.push(`Fallback: ${degradation}`);
	return lines.join("\n");
}

function geoJson(title: string, locations: readonly MapLocationV1[]): string {
	return `${JSON.stringify(
		{
			type: "FeatureCollection",
			name: title,
			features: locations.map(location => ({
				type: "Feature",
				id: location.id,
				geometry:
					location.longitude === undefined
						? null
						: { type: "Point", coordinates: [location.longitude, location.latitude] },
				properties: {
					label: location.label,
					precision: location.precision,
					resolution: location.resolution,
					confidence: location.confidence,
					sources: location.sources,
				},
			})),
		},
		null,
		2,
	)}\n`;
}

function exportPaths(cwd: string, requested: string): { png: string; geojson: string } {
	const resolved = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(cwd, requested);
	const base = resolved.replace(/\.(?:png|geojson)$/iu, "");
	if (!path.basename(base)) throw new ToolError("savePath must name an output file base");
	return { png: `${base}.png`, geojson: `${base}.geojson` };
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

async function saveMap(
	cwd: string,
	requested: string,
	overwrite: boolean,
	png: Buffer,
	geojson: string,
): Promise<{ png: string; geojson: string }> {
	const targets = exportPaths(cwd, requested);
	if (!overwrite && ((await exists(targets.png)) || (await exists(targets.geojson)))) {
		throw new ToolError("map output exists; set overwrite=true to replace both files");
	}
	await fs.mkdir(path.dirname(targets.png), { recursive: true });
	const nonce = `${process.pid}-${Date.now()}`;
	const pngTemporary = `${targets.png}.${nonce}.tmp`;
	const geojsonTemporary = `${targets.geojson}.${nonce}.tmp`;
	try {
		await Promise.all([Bun.write(pngTemporary, png), Bun.write(geojsonTemporary, geojson)]);
		await fs.rename(geojsonTemporary, targets.geojson);
		await fs.rename(pngTemporary, targets.png);
	} finally {
		await Promise.all([fs.rm(pngTemporary, { force: true }), fs.rm(geojsonTemporary, { force: true })]);
	}
	return targets;
}

export class RenderMapTool implements AgentTool<typeof renderMapSchema, MediaToolResultV1> {
	readonly name = "render_map";
	readonly label = "RenderMap";
	readonly description = prompt.render(renderMapDescription);
	readonly parameters = renderMapSchema;
	readonly strict = true;

	constructor(
		private readonly session: ToolSession,
		private readonly dependencies: RenderMapDependencies = {},
	) {}

	async execute(
		_toolCallId: string,
		params: RenderMapParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<MediaToolResultV1>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<MediaToolResultV1>> {
		const locations = params.locations.map(validateMapLocationV1);
		const plottable = locations.filter(location => location.longitude !== undefined);
		if (plottable.length === 0 || this.session.settings.get("images.blockImages")) {
			const reason =
				plottable.length === 0
					? "No locations had provenance-backed coordinates, so no image was generated."
					: "Media display is disabled by settings; no image was generated.";
			return { content: [{ type: "text", text: evidenceText(params.title, locations, reason) }] };
		}

		let rendered: RenderedMap;
		try {
			rendered = await (this.dependencies.render ?? renderMap)({
				title: params.title,
				locations: plottable,
				basemap: params.basemap ?? "osm",
				signal,
				settings: this.session.settings,
			});
		} catch (error) {
			const reason = `Graphical generation failed; evidence remains available (${error instanceof Error ? error.message : String(error)}).`;
			return { content: [{ type: "text", text: evidenceText(params.title, locations, reason) }] };
		}

		let saved: { png: string; geojson: string } | undefined;
		if (params.savePath) {
			saved = await saveMap(
				this.session.cwd,
				params.savePath,
				params.overwrite ?? false,
				rendered.png,
				geoJson(params.title, locations),
			);
		}
		const ingestor = new MediaIngestor({
			cwd: this.session.cwd,
			blobStore: this.session.mediaBlobStore ?? new BlobStore(getBlobsDir()),
			internalRouter: this.session.internalRouter,
		});
		try {
			const ingested = await ingestor.ingestBuffer(
				{
					data: rendered.png,
					mimeType: "image/png",
					width: MAP_WIDTH,
					height: MAP_HEIGHT,
					filenameHint: "map.png",
					metadata: { producer: "render_map", basemap: rendered.basemap },
					caption: params.title,
					alt: `Map titled ${params.title} with ${plottable.length} plotted locations`,
					provenance: { sourceType: "tool", source: "render_map" },
				},
				signal,
			);
			const text = evidenceText(params.title, locations, rendered.degradation);
			const saveNotice = saved ? `Saved PNG: ${saved.png}\nSaved GeoJSON: ${saved.geojson}` : undefined;
			return publishMedia(this.session, ingested, { text: saveNotice ? [text, saveNotice] : [text] });
		} catch (error) {
			if (error instanceof MediaIngestError) throw new ToolError(error.message);
			throw error;
		}
	}
}
