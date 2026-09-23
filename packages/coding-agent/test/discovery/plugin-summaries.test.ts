import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearXcshPluginRootsCache, listXcshPluginSummaries, readPluginSummary } from "../../src/discovery/helpers";

async function mkRoot(files: Record<string, unknown>): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xps-"));
	for (const [rel, content] of Object.entries(files)) {
		const p = path.join(dir, rel);
		await fs.mkdir(path.join(p, ".."), { recursive: true });
		await fs.writeFile(p, JSON.stringify(content));
	}
	return dir;
}

describe("readPluginSummary", () => {
	afterEach(() => clearXcshPluginRootsCache());
	test("reads name+description from .xcsh-plugin/plugin.json", async () => {
		const path = await mkRoot({
			".xcsh-plugin/plugin.json": { name: "meddpicc", description: "MEDDPICC framework" },
		});
		expect(await readPluginSummary({ plugin: "meddpicc", path })).toEqual({
			id: "meddpicc",
			name: "meddpicc",
			description: "MEDDPICC framework",
		});
	});
	test("falls back to package.json xcsh field", async () => {
		const path = await mkRoot({ "package.json": { xcsh: { name: "foo", description: "Foo tool" } } });
		expect(await readPluginSummary({ plugin: "foo", path })).toEqual({
			id: "foo",
			name: "foo",
			description: "Foo tool",
		});
	});
	test("falls back to package.json pi field", async () => {
		const path = await mkRoot({ "package.json": { pi: { name: "legacy", description: "Legacy tool" } } });
		expect(await readPluginSummary({ plugin: "legacy", path })).toEqual({
			id: "legacy",
			name: "legacy",
			description: "Legacy tool",
		});
	});
	test("no manifest → name from root.plugin, empty description", async () => {
		const path = await mkRoot({});
		expect(await readPluginSummary({ plugin: "bare", path })).toEqual({
			id: "bare",
			name: "bare",
			description: "",
		});
	});
	test("manifest without name → falls back to root.plugin", async () => {
		const path = await mkRoot({ ".xcsh-plugin/plugin.json": { description: "desc only" } });
		expect(await readPluginSummary({ plugin: "baz", path })).toEqual({
			id: "baz",
			name: "baz",
			description: "desc only",
		});
	});
	test("id is the registry id even when the manifest name differs", async () => {
		const path = await mkRoot({
			".xcsh-plugin/plugin.json": { name: "Display Name", description: "mismatched name" },
		});
		expect(await readPluginSummary({ plugin: "registry-id", path })).toEqual({
			id: "registry-id",
			name: "Display Name",
			description: "mismatched name",
		});
	});
	test("multi-line / oversized description is collapsed to one line and capped with …", async () => {
		const longDescription = `line one\nline two\t${"x".repeat(400)}`;
		const path = await mkRoot({
			".xcsh-plugin/plugin.json": { name: "big", description: longDescription },
		});
		const summary = await readPluginSummary({ plugin: "big", path });
		expect(summary.id).toBe("big");
		expect(summary.description).not.toContain("\n");
		expect(summary.description).not.toContain("\t");
		expect(summary.description.startsWith("line one line two ")).toBe(true);
		expect(summary.description.length).toBe(301); // 300 chars + the "…" ellipsis
		expect(summary.description.endsWith("…")).toBe(true);
	});
});

describe("listXcshPluginSummaries cache", () => {
	test("deduplicates eight concurrent loads and performs one fresh load after invalidation", async () => {
		let rootLoads = 0;
		let summaryLoads = 0;
		const dependencies = {
			resolveProjectRegistryPath: async () => "/project/.xcsh/plugins/installed_plugins.json",
			loadRoots: async () => {
				rootLoads += 1;
				await Bun.sleep(10);
				return {
					roots: [
						{
							id: "fixture@marketplace",
							marketplace: "marketplace",
							plugin: "fixture",
							version: "1.0.0",
							path: "/plugin",
							scope: "user" as const,
						},
					],
					warnings: [],
				};
			},
			loadSummary: async () => {
				summaryLoads += 1;
				return { id: "fixture", name: "fixture", description: `load-${summaryLoads}` };
			},
		};

		const first = await Promise.all(
			Array.from({ length: 8 }, () =>
				listXcshPluginSummaries("/tmp/xcsh-test-home", "/project", undefined, dependencies),
			),
		);
		expect(rootLoads).toBe(1);
		expect(summaryLoads).toBe(1);
		expect(new Set(first.map(result => result[0]?.description))).toEqual(new Set(["load-1"]));

		clearXcshPluginRootsCache();
		const second = await Promise.all(
			Array.from({ length: 8 }, () =>
				listXcshPluginSummaries("/tmp/xcsh-test-home", "/project", undefined, dependencies),
			),
		);
		expect(rootLoads).toBe(2);
		expect(summaryLoads).toBe(2);
		expect(new Set(second.map(result => result[0]?.description))).toEqual(new Set(["load-2"]));
	});

	test("a failed load is evicted and does not poison the next request", async () => {
		let attempts = 0;
		const dependencies = {
			resolveProjectRegistryPath: async () => "/project/.xcsh/plugins/installed_plugins.json",
			loadRoots: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("fixture failure");
				return { roots: [], warnings: [] };
			},
			loadSummary: async () => ({ id: "unused", name: "unused", description: "" }),
		};

		expect(await listXcshPluginSummaries("/tmp/xcsh-failure-home", "/project", undefined, dependencies)).toEqual([]);
		expect(await listXcshPluginSummaries("/tmp/xcsh-failure-home", "/project", undefined, dependencies)).toEqual([]);
		expect(attempts).toBe(2);
	});

	test("an aborted load is evicted and does not poison the next request", async () => {
		let attempts = 0;
		const controller = new AbortController();
		const dependencies = {
			resolveProjectRegistryPath: async () => "/project/.xcsh/plugins/installed_plugins.json",
			loadRoots: async (_home: string, _cwd?: string, signal?: AbortSignal) => {
				attempts += 1;
				if (attempts === 1) {
					controller.abort(new Error("fixture abort"));
					signal?.throwIfAborted();
				}
				return { roots: [], warnings: [] };
			},
			loadSummary: async () => ({ id: "unused", name: "unused", description: "" }),
		};

		await expect(
			listXcshPluginSummaries("/tmp/xcsh-abort-home", "/project", controller.signal, dependencies),
		).rejects.toThrow("fixture abort");
		expect(await listXcshPluginSummaries("/tmp/xcsh-abort-home", "/project", undefined, dependencies)).toEqual([]);
		expect(attempts).toBe(2);
	});
});
