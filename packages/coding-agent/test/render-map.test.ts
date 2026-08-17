import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { buildMapSvg } from "../src/map/render";
import { fitMapLocations, validateMapLocationV1 } from "../src/map/types";
import type { MediaMessage } from "../src/media/types";
import { BlobStore } from "../src/session/blob-store";
import type { ToolSession } from "../src/tools";
import { RenderMapTool } from "../src/tools/render-map";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const source = {
	url: "https://status.example.test/edge/yyz",
	sourceName: "Example status",
	observedAt: "2026-08-15T12:00:00.000Z",
	claim: "The current entry publishes this representative coordinate.",
};

const location = {
	id: "yyz-edge",
	label: "Toronto edge",
	longitude: -79.3832,
	latitude: 43.6532,
	precision: "metro" as const,
	resolution: "approximate" as const,
	confidence: "medium" as const,
	sources: [source],
};

function expectDeterministicMapSemantics(svg: string): void {
	expect(svg).toContain('class="title">Current edges</text>');
	expect(svg).toContain('class="marker">1</text>');
	expect(svg).toContain('class="label">Toronto edge</text>');
	expect(svg).toContain('<g class="legend">');
	expect(svg).toContain("approximate / inferred");
	expect(svg).toContain('class="attribution">Schematic Web Mercator • no basemap tiles</text>');
	expect(svg).not.toContain("Unresolved edge");
}

describe("MapLocationV1", () => {
	test("rejects coordinates without current-request provenance", () => {
		expect(() => validateMapLocationV1({ ...location, sources: [] })).toThrow("provenance");
	});

	test("preserves unresolved evidence without making it plottable", () => {
		const unresolved = validateMapLocationV1({
			id: "unknown",
			label: "Unknown edge",
			precision: "unresolved",
			resolution: "unresolved",
			confidence: "unknown",
			sources: [source],
		});
		expect(unresolved.longitude).toBeUndefined();
	});

	test("fits antimeridian neighbors as a local extent", () => {
		const fitted = fitMapLocations([
			validateMapLocationV1({ ...location, id: "east", longitude: 179.5 }),
			validateMapLocationV1({ ...location, id: "west", longitude: -179.5 }),
		]);
		expect(fitted.spanX).toBeLessThan(0.01);
	});

	test("builds deterministic schematic output with visible attribution and styling", () => {
		const value = validateMapLocationV1(location);
		const unresolved = validateMapLocationV1({
			id: "unresolved-edge",
			label: "Unresolved edge",
			precision: "unresolved",
			resolution: "unresolved",
			confidence: "unknown",
			sources: [source],
		});
		const first = buildMapSvg("Current edges", [value, unresolved], "schematic");
		const second = buildMapSvg("Current edges", [value, unresolved], "schematic");
		expect(first).toBe(second);
		expectDeterministicMapSemantics(first);
		expect(() => expectDeterministicMapSemantics(first.replace("Toronto edge", ""))).toThrow();
	});
});

test("render_map publishes exactly one generated image through the canonical media result", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-render-map-"));
	roots.push(root);
	const png = Buffer.alloc(24);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	png.writeUInt32BE(1200, 16);
	png.writeUInt32BE(760, 20);
	const messages: MediaMessage[] = [];
	const session = {
		cwd: root,
		hasUI: true,
		settings: Settings.isolated({}),
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		mediaBlobStore: new BlobStore(path.join(root, "blobs")),
		appendMediaMessage: message => messages.push(message),
	} as ToolSession;
	const tool = new RenderMapTool(session, {
		render: async () => ({ png, basemap: "schematic" }),
	});
	const result = await tool.execute("call", { title: "Current edges", locations: [location] });

	expect(result.details?.mediaResult).toBe("xcsh.media/v1");
	expect(result.details?.descriptor.provenance).toEqual({ sourceType: "tool", source: "render_map" });
	expect(messages).toHaveLength(1);
	expect(result.content.filter(block => block.type === "image")).toHaveLength(1);
	expect(result.content.find(block => block.type === "text")?.text).toContain("Toronto edge");
	expect(await fs.readdir(root)).toEqual(["blobs"]);
});

test("render_map writes PNG and GeoJSON atomically only when explicitly requested", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-render-map-save-"));
	roots.push(root);
	const png = Buffer.alloc(24);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	png.writeUInt32BE(1200, 16);
	png.writeUInt32BE(760, 20);
	const session = {
		cwd: root,
		hasUI: false,
		settings: Settings.isolated({}),
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		mediaBlobStore: new BlobStore(path.join(root, "blobs")),
	} as ToolSession;
	const tool = new RenderMapTool(session, { render: async () => ({ png, basemap: "schematic" }) });
	await tool.execute("call", { title: "Saved", locations: [location], savePath: "edge-map" });
	expect(await fs.readFile(path.join(root, "edge-map.png"))).toEqual(png);
	const geojson = JSON.parse(await fs.readFile(path.join(root, "edge-map.geojson"), "utf8"));
	expect(geojson.features).toHaveLength(1);
	await expect(tool.execute("call", { title: "Saved", locations: [location], savePath: "edge-map" })).rejects.toThrow(
		"overwrite",
	);
});
