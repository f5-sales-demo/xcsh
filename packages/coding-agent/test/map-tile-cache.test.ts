import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { OSM_TILE_USER_AGENT, OsmTileFetcher } from "../src/map/tile-cache";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function png(): Buffer {
	return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
}

describe("OSM tile cache policy", () => {
	test("uses an identifiable client, honors freshness, and conditionally revalidates", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-osm-cache-"));
		roots.push(root);
		let now = 1_000;
		const requests: Array<{ url: string; headers: Headers }> = [];
		const responses = [
			new Response(png(), {
				status: 200,
				headers: { "content-type": "image/png", "cache-control": "max-age=10", etag: '"tile-1"' },
			}),
			new Response(null, { status: 304, headers: { "cache-control": "max-age=20" } }),
		];
		const fetcher = new OsmTileFetcher({
			cacheDir: root,
			now: () => now,
			fetch: async (input, init) => {
				requests.push({ url: String(input), headers: new Headers(init?.headers) });
				return responses.shift()!;
			},
		});
		const tile = { z: 2, x: 1, y: 1 };
		expect(await fetcher.fetchTile(tile)).toEqual(png());
		expect(await fetcher.fetchTile(tile)).toEqual(png());
		expect(requests).toHaveLength(1);
		expect(requests[0]!.url).toBe("https://tile.openstreetmap.org/2/1/1.png");
		expect(requests[0]!.headers.get("user-agent")).toBe(OSM_TILE_USER_AGENT);
		now = 12_000;
		expect(await fetcher.fetchTile(tile)).toEqual(png());
		expect(requests[1]!.headers.get("if-none-match")).toBe('"tile-1"');
	});

	test("does not persist a response marked no-store", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-osm-no-store-"));
		roots.push(root);
		let calls = 0;
		const fetcher = new OsmTileFetcher({
			cacheDir: root,
			fetch: async () => {
				calls++;
				return new Response(png(), {
					status: 200,
					headers: { "content-type": "image/png", "cache-control": "no-store" },
				});
			},
		});
		await fetcher.fetchTile({ z: 1, x: 0, y: 0 });
		await fetcher.fetchTile({ z: 1, x: 0, y: 0 });
		expect(calls).toBe(2);
	});
});
