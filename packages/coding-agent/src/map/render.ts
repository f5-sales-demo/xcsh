import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getPuppeteerDir } from "@f5-sales-demo/pi-utils";
import type { Browser, Page, default as Puppeteer } from "puppeteer";
import { locateChrome } from "../browser/chrome-locate";
import { OsmTileFetcher, type TileRequest } from "./tile-cache";
import { type FittedMapLocations, fitMapLocations, type MapLocationV1 } from "./types";

export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 760;
const PLOT = { x: 32, y: 72, width: 1136, height: 590 };
const MAX_VIEWPORT_TILES = 48;

export interface RenderMapRequest {
	title: string;
	locations: MapLocationV1[];
	basemap: "osm" | "schematic";
	signal?: AbortSignal;
	settings?: { get(key: string): unknown };
}

export interface RenderedMap {
	png: Buffer;
	basemap: "osm" | "schematic";
	degradation?: string;
}

export interface RenderMapDependencies {
	tileFetcher?: OsmTileFetcher;
	rasterize?: (svg: string, settings?: { get(key: string): unknown }, signal?: AbortSignal) => Promise<Buffer>;
}

interface Viewport {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	spanX: number;
	spanY: number;
}

interface TileImage extends TileRequest {
	logicalX: number;
	data: Buffer;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/gu, character => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&apos;";
		}
	});
}

function viewportFor(fit: FittedMapLocations): Viewport {
	const paddingX = Math.max(fit.spanX * 0.12, 1 / 512);
	const paddingY = Math.max(fit.spanY * 0.12, 1 / 512);
	let minX = fit.minX - paddingX;
	let maxX = fit.maxX + paddingX;
	let minY = Math.max(0, fit.minY - paddingY);
	let maxY = Math.min(1, fit.maxY + paddingY);
	const desiredAspect = PLOT.width / PLOT.height;
	const currentAspect = (maxX - minX) / (maxY - minY);
	if (currentAspect < desiredAspect) {
		const extra = ((maxY - minY) * desiredAspect - (maxX - minX)) / 2;
		minX -= extra;
		maxX += extra;
	} else {
		const extra = ((maxX - minX) / desiredAspect - (maxY - minY)) / 2;
		minY = Math.max(0, minY - extra);
		maxY = Math.min(1, maxY + extra);
	}
	return { minX, maxX, minY, maxY, spanX: maxX - minX, spanY: maxY - minY };
}

function tileRequests(viewport: Viewport): Array<Omit<TileImage, "data">> {
	let zoom = Math.max(
		1,
		Math.min(
			12,
			Math.floor(Math.log2(Math.min(PLOT.width / (viewport.spanX * 256), PLOT.height / (viewport.spanY * 256)))),
		),
	);
	for (;;) {
		const count = 2 ** zoom;
		const minLogicalX = Math.floor(viewport.minX * count);
		const maxLogicalX = Math.floor(viewport.maxX * count - Number.EPSILON);
		const minY = Math.max(0, Math.floor(viewport.minY * count));
		const maxY = Math.min(count - 1, Math.floor(viewport.maxY * count - Number.EPSILON));
		const requests: Array<Omit<TileImage, "data">> = [];
		for (let y = minY; y <= maxY; y++) {
			for (let logicalX = minLogicalX; logicalX <= maxLogicalX; logicalX++) {
				requests.push({ z: zoom, x: ((logicalX % count) + count) % count, y, logicalX });
			}
		}
		if (requests.length <= MAX_VIEWPORT_TILES || zoom === 1) return requests;
		zoom--;
	}
}

async function loadTiles(viewport: Viewport, fetcher: OsmTileFetcher, signal?: AbortSignal): Promise<TileImage[]> {
	const requests = tileRequests(viewport);
	const result: TileImage[] = [];
	// Deliberately bounded and sequential: viewport tiles only, with no prefetch or bulk endpoint behavior.
	for (const request of requests) {
		signal?.throwIfAborted();
		result.push({ ...request, data: await fetcher.fetchTile(request, signal) });
	}
	return result;
}

function screenPoint(worldX: number, worldY: number, viewport: Viewport): { x: number; y: number } {
	return {
		x: PLOT.x + ((worldX - viewport.minX) / viewport.spanX) * PLOT.width,
		y: PLOT.y + ((worldY - viewport.minY) / viewport.spanY) * PLOT.height,
	};
}

function schematicBackground(): string {
	const lines: string[] = [
		`<rect x="${PLOT.x}" y="${PLOT.y}" width="${PLOT.width}" height="${PLOT.height}" fill="#eef4f7"/>`,
	];
	for (let index = 1; index < 8; index++) {
		const x = PLOT.x + (PLOT.width * index) / 8;
		lines.push(`<line x1="${x}" y1="${PLOT.y}" x2="${x}" y2="${PLOT.y + PLOT.height}"/>`);
	}
	for (let index = 1; index < 5; index++) {
		const y = PLOT.y + (PLOT.height * index) / 5;
		lines.push(`<line x1="${PLOT.x}" y1="${y}" x2="${PLOT.x + PLOT.width}" y2="${y}"/>`);
	}
	return `<g stroke="#cbd9df" stroke-width="1">${lines.join("")}</g>`;
}

function tileBackground(tiles: TileImage[], viewport: Viewport): string {
	return tiles
		.map(tile => {
			const count = 2 ** tile.z;
			const x = PLOT.x + (tile.logicalX / count - viewport.minX) * (PLOT.width / viewport.spanX);
			const y = PLOT.y + (tile.y / count - viewport.minY) * (PLOT.height / viewport.spanY);
			const width = PLOT.width / (count * viewport.spanX);
			const height = PLOT.height / (count * viewport.spanY);
			return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/png;base64,${tile.data.toString("base64")}"/>`;
		})
		.join("");
}

interface MarkerGroup {
	x: number;
	y: number;
	indexes: number[];
	locations: MapLocationV1[];
}

function groupMarkers(fit: FittedMapLocations, viewport: Viewport, original: readonly MapLocationV1[]): MarkerGroup[] {
	const order = new Map(original.map((location, index) => [location.id, index + 1]));
	const groups: MarkerGroup[] = [];
	for (const point of [...fit.locations].sort((a, b) => a.location.id.localeCompare(b.location.id))) {
		const screen = screenPoint(point.worldX, point.worldY, viewport);
		const group = groups.find(candidate => Math.hypot(candidate.x - screen.x, candidate.y - screen.y) < 30);
		if (group) {
			group.locations.push(point.location);
			group.indexes.push(order.get(point.location.id)!);
			group.x = (group.x * (group.locations.length - 1) + screen.x) / group.locations.length;
			group.y = (group.y * (group.locations.length - 1) + screen.y) / group.locations.length;
		} else {
			groups.push({
				x: screen.x,
				y: screen.y,
				indexes: [order.get(point.location.id)!],
				locations: [point.location],
			});
		}
	}
	for (const group of groups) group.indexes.sort((a, b) => a - b);
	return groups;
}

function markerSvg(groups: MarkerGroup[]): string {
	const labels: Array<{ x: number; y: number; width: number; height: number }> = [];
	return groups
		.map((group, groupIndex) => {
			const primary = group.locations[0]!;
			const fill =
				primary.confidence === "high" ? "#0b6bcb" : primary.confidence === "medium" ? "#c76a00" : "#7b4ba3";
			const dash = ["city", "metro", "approximate", "inferred"].includes(primary.precision)
				? ' stroke-dasharray="4 2"'
				: "";
			const markerText = group.indexes.join(",");
			const labelText = group.locations.map(location => location.label).join(" / ");
			const labelWidth = Math.min(330, Math.max(100, labelText.length * 7.2 + 18));
			const labelX = Math.min(PLOT.x + PLOT.width - labelWidth - 4, group.x + 17);
			let labelY = Math.max(PLOT.y + 4, group.y - 15);
			let attempts = 0;
			while (
				attempts < 20 &&
				labels.some(
					label => Math.abs(label.x - labelX) < (label.width + labelWidth) / 2 && Math.abs(label.y - labelY) < 28,
				)
			) {
				attempts++;
				labelY += 28;
				if (labelY > PLOT.y + PLOT.height - 25) {
					labelY = Math.max(PLOT.y + 4, group.y - 15 - attempts * 28 - groupIndex * 2);
				}
			}
			labels.push({ x: labelX, y: labelY, width: labelWidth, height: 24 });
			return `<g><circle cx="${group.x}" cy="${group.y}" r="13" fill="${fill}" stroke="#fff" stroke-width="3"${dash}/><text x="${group.x}" y="${group.y + 4}" text-anchor="middle" class="marker">${escapeXml(markerText)}</text><rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="24" rx="5" fill="#ffffff" fill-opacity="0.92" stroke="#66747b"/><text x="${labelX + 8}" y="${labelY + 16}" class="label">${escapeXml(labelText.slice(0, 44))}</text></g>`;
		})
		.join("");
}

export function buildMapSvg(
	title: string,
	locations: readonly MapLocationV1[],
	basemap: "osm" | "schematic",
	tiles: TileImage[] = [],
): string {
	const fit = fitMapLocations(locations);
	const viewport = viewportFor(fit);
	const background = basemap === "osm" ? tileBackground(tiles, viewport) : schematicBackground();
	const attribution =
		basemap === "osm"
			? "© OpenStreetMap contributors • openstreetmap.org/copyright"
			: "Schematic Web Mercator • no basemap tiles";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"><style>text{font-family:Arial,sans-serif;fill:#17242b}.title{font-size:26px;font-weight:700}.label{font-size:13px}.marker{font-size:10px;font-weight:700;fill:#fff}.legend{font-size:13px}.attribution{font-size:12px;fill:#394b54}</style><rect width="1200" height="760" fill="#fff"/><text x="32" y="42" class="title">${escapeXml(title)}</text><defs><clipPath id="plot"><rect x="${PLOT.x}" y="${PLOT.y}" width="${PLOT.width}" height="${PLOT.height}"/></clipPath></defs><g clip-path="url(#plot)">${background}</g><rect x="${PLOT.x}" y="${PLOT.y}" width="${PLOT.width}" height="${PLOT.height}" fill="none" stroke="#50636c"/>${markerSvg(groupMarkers(fit, viewport, locations))}<g class="legend"><circle cx="45" cy="698" r="8" fill="#0b6bcb"/><text x="59" y="703">high confidence</text><circle cx="190" cy="698" r="8" fill="#c76a00"/><text x="204" y="703">medium</text><circle cx="290" cy="698" r="8" fill="#7b4ba3"/><text x="304" y="703">low / unknown</text><circle cx="424" cy="698" r="8" fill="none" stroke="#17242b" stroke-dasharray="4 2"/><text x="438" y="703">approximate / inferred</text></g><text x="32" y="738" class="attribution">${escapeXml(attribution)}</text></svg>`;
}

let puppeteerModule: typeof Puppeteer | undefined;
async function loadPuppeteer(): Promise<typeof Puppeteer> {
	if (puppeteerModule) return puppeteerModule;
	const safeDir = getPuppeteerDir();
	await fs.mkdir(safeDir, { recursive: true });
	await Bun.write(path.join(safeDir, "package.json"), "{}");
	const previous = process.cwd();
	try {
		process.chdir(safeDir);
		puppeteerModule = (await import("puppeteer")).default;
		return puppeteerModule;
	} finally {
		process.chdir(previous);
	}
}

export async function rasterizeMapSvg(
	svg: string,
	settings?: { get(key: string): unknown },
	signal?: AbortSignal,
): Promise<Buffer> {
	const chrome = locateChrome({ settings });
	if (!chrome) throw new Error("Chrome is unavailable for network-isolated map rasterization");
	const puppeteer = await loadPuppeteer();
	let browser: Browser | undefined;
	try {
		browser = await puppeteer.launch({
			headless: true,
			executablePath: chrome.path,
			args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"],
		});
		const page: Page = await browser.newPage();
		await page.setJavaScriptEnabled(false);
		await page.setRequestInterception(true);
		page.on("request", request => {
			if (request.url().startsWith("data:")) void request.continue();
			else void request.abort("blockedbyclient");
		});
		await page.setViewport({ width: MAP_WIDTH, height: MAP_HEIGHT, deviceScaleFactor: 1 });
		signal?.throwIfAborted();
		await page.setContent(
			`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${MAP_WIDTH}px;height:${MAP_HEIGHT}px;overflow:hidden}</style></head><body>${svg}</body></html>`,
			{
				waitUntil: "domcontentloaded",
			},
		);
		signal?.throwIfAborted();
		return Buffer.from(
			await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT } }),
		);
	} finally {
		await browser?.close();
	}
}

export async function renderMap(
	request: RenderMapRequest,
	dependencies: RenderMapDependencies = {},
): Promise<RenderedMap> {
	const fit = fitMapLocations(request.locations);
	const viewport = viewportFor(fit);
	const rasterize = dependencies.rasterize ?? rasterizeMapSvg;
	let basemap = request.basemap;
	let degradation: string | undefined;
	let tiles: TileImage[] = [];
	if (basemap === "osm") {
		try {
			const fetcher =
				dependencies.tileFetcher ?? new OsmTileFetcher({ cacheDir: path.join(getPuppeteerDir(), "osm-tiles") });
			tiles = await loadTiles(viewport, fetcher, request.signal);
		} catch (error) {
			basemap = "schematic";
			degradation = `OpenStreetMap tiles were unavailable; rendered a schematic map (${error instanceof Error ? error.message : String(error)}).`;
		}
	}
	const svg = buildMapSvg(request.title, request.locations, basemap, tiles);
	return { png: await rasterize(svg, request.settings, request.signal), basemap, degradation };
}
