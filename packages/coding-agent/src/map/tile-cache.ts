import * as fs from "node:fs/promises";
import * as path from "node:path";

export const OSM_TILE_USER_AGENT = "xcsh-map-renderer/1.0 (+https://github.com/f5-sales-demo/xcsh)";
const MAX_TILE_BYTES = 1024 * 1024;

interface TileMetadata {
	etag?: string;
	lastModified?: string;
	expiresAt: number;
}

export interface TileRequest {
	z: number;
	x: number;
	y: number;
}

export interface OsmTileFetcherOptions {
	cacheDir: string;
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	now?: () => number;
}

function cacheLifetime(headers: Headers, now: number): number {
	const cacheControl = headers.get("cache-control") ?? "";
	if (/\bno-store\b/iu.test(cacheControl)) return 0;
	const maxAge = /\bmax-age=(\d+)\b/iu.exec(cacheControl)?.[1];
	if (maxAge) return Number(maxAge) * 1000;
	const expires = headers.get("expires");
	if (expires) return Math.max(0, Date.parse(expires) - now);
	return 0;
}

function validateTile(data: Buffer): void {
	if (data.byteLength === 0 || data.byteLength > MAX_TILE_BYTES) throw new Error("OSM tile size is invalid");
	if (!data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		throw new Error("OSM tile is not a valid PNG");
	}
}

async function readMetadata(file: string): Promise<TileMetadata | undefined> {
	try {
		const value = JSON.parse(await fs.readFile(file, "utf8")) as Partial<TileMetadata>;
		if (!Number.isFinite(value.expiresAt)) return undefined;
		return value as TileMetadata;
	} catch {
		return undefined;
	}
}

export class OsmTileFetcher {
	readonly #options: Required<Omit<OsmTileFetcherOptions, "cacheDir">> & Pick<OsmTileFetcherOptions, "cacheDir">;

	constructor(options: OsmTileFetcherOptions) {
		this.#options = {
			cacheDir: options.cacheDir,
			fetch: options.fetch ?? ((input, init) => fetch(input, init)),
			now: options.now ?? Date.now,
		};
	}

	async fetchTile(tile: TileRequest, signal?: AbortSignal): Promise<Buffer> {
		if (!Number.isInteger(tile.z) || tile.z < 0 || tile.z > 19) throw new Error("invalid OSM tile zoom");
		const count = 2 ** tile.z;
		if (
			!Number.isInteger(tile.x) ||
			tile.x < 0 ||
			tile.x >= count ||
			!Number.isInteger(tile.y) ||
			tile.y < 0 ||
			tile.y >= count
		) {
			throw new Error("invalid OSM tile coordinate");
		}
		const base = path.join(this.#options.cacheDir, String(tile.z), String(tile.x), String(tile.y));
		const pngPath = `${base}.png`;
		const metadataPath = `${base}.json`;
		const now = this.#options.now();
		const metadata = await readMetadata(metadataPath);
		let cached: Buffer | undefined;
		try {
			cached = await fs.readFile(pngPath);
			validateTile(cached);
		} catch {
			cached = undefined;
		}
		if (cached && metadata && metadata.expiresAt > now) return cached;

		const headers = new Headers({
			Accept: "image/png",
			Referer: "https://github.com/f5-sales-demo/xcsh",
			"User-Agent": OSM_TILE_USER_AGENT,
		});
		if (cached && metadata?.etag) headers.set("If-None-Match", metadata.etag);
		if (cached && metadata?.lastModified) headers.set("If-Modified-Since", metadata.lastModified);
		const response = await this.#options.fetch(`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`, {
			headers,
			redirect: "error",
			signal,
		});
		if (response.status === 304 && cached) {
			await this.#writeMetadata(metadataPath, response.headers, now, metadata);
			return cached;
		}
		if (!response.ok) throw new Error(`OSM tile request failed with HTTP ${response.status}`);
		const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
		if (contentType !== "image/png") throw new Error("OSM tile response was not image/png");
		const declaredLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_TILE_BYTES) throw new Error("OSM tile is too large");
		const data = Buffer.from(await response.arrayBuffer());
		validateTile(data);
		if (!/\bno-store\b/iu.test(response.headers.get("cache-control") ?? "")) {
			await fs.mkdir(path.dirname(pngPath), { recursive: true });
			await Bun.write(pngPath, data);
			await this.#writeMetadata(metadataPath, response.headers, now);
		}
		return data;
	}

	async #writeMetadata(file: string, headers: Headers, now: number, previous?: TileMetadata): Promise<void> {
		const value: TileMetadata = {
			etag: headers.get("etag") ?? previous?.etag,
			lastModified: headers.get("last-modified") ?? previous?.lastModified,
			expiresAt: now + cacheLifetime(headers, now),
		};
		await fs.mkdir(path.dirname(file), { recursive: true });
		await Bun.write(file, `${JSON.stringify(value)}\n`);
	}
}
