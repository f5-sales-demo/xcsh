import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import { QMD_API_CATALOG_PREBUILT_INDEX } from "../../src/internal-urls/api-catalog-qmd-index.generated";

test("production catalog loads without QMD and preserves the pinned lexical ranking", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "xcsh-production-catalog-"));
	try {
		const fixture = JSON.parse(
			await readFile(path.join(import.meta.dir, "../../bench/fixtures/api-catalog-retrieval-v1.json"), "utf8"),
		);
		const queries = [
			...fixture.queries.map((q: { query: string }) => q.query),
			"dns zone",
			'"dns zone"',
			"dns -http",
			"dns-zones",
			"1.2.3",
			"東京",
			"-dns",
			"",
			"OR * : ()",
			'dns "zone',
			'dns -"zone"',
		];
		const db = path.join(root, "reference.sqlite");
		await writeFile(db, gunzipSync(Buffer.from(QMD_API_CATALOG_PREBUILT_INDEX.gzipBase64, "base64")));
		const reference = await createStore({ dbPath: db });
		const expected: unknown[] = [];
		try {
			for (const query of queries) {
				const results = await reference.searchLex(query, { limit: 5 });
				expected.push(
					results.flatMap(r => {
						const categoryName = /^- Destination: xcsh:\/\/api-catalog\/([^\s]+)$/m.exec(r.body ?? "")?.[1];
						return categoryName && /^[a-z0-9-]+$/.test(categoryName)
							? [{ categoryName, destination: `xcsh://api-catalog/${categoryName}` }]
							: [];
					}),
				);
			}
		} finally {
			await reference.close();
		}
		expect(expected.some(r => (r as unknown[]).length > 0)).toBe(true);
		const build = await Bun.build({
			entrypoints: [path.join(import.meta.dir, "../../src/internal-urls/api-catalog-discovery.ts")],
			target: "bun",
			external: ["@tobilu/qmd"],
			outdir: root,
		});
		expect(build.success).toBe(true);
		await writeFile(
			path.join(root, "input.json"),
			JSON.stringify({ queries, prebuiltIndex: QMD_API_CATALOG_PREBUILT_INDEX }),
		);
		await writeFile(
			path.join(root, "probe.ts"),
			`import { rankQmdBm25CatalogDiscovery } from "./api-catalog-discovery.js";
const input = await Bun.file(import.meta.dir + "/input.json").json();
const results = [];
for (const query of input.queries) results.push(await rankQmdBm25CatalogDiscovery(query, { cacheRoot: import.meta.dir + "/cache", prebuiltIndex: input.prebuiltIndex }));
console.log(JSON.stringify(results));`,
		);
		const child = Bun.spawn([process.execPath, "--no-install", path.join(root, "probe.ts")], {
			cwd: root,
			env: { PATH: process.env.PATH, HOME: root },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [output, error, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ code, error }).toEqual({ code: 0, error: "" });
		expect(JSON.parse(output)).toEqual(expected);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
