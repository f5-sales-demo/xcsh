import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { createPluginResolver, type PluginRootLike } from "../../src/internal-urls/plugin-resolve";
import type { InternalUrl } from "../../src/internal-urls/types";

let root: string;
let roots: PluginRootLike[];

function u(input: string): InternalUrl {
	return parseInternalUrl(input) as InternalUrl;
}

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-resolve-PK-"));
	await fs.mkdir(path.join(root, ".xcsh-plugin"), { recursive: true });
	await fs.mkdir(path.join(root, "schema"), { recursive: true });
	await fs.mkdir(path.join(root, "engine"), { recursive: true });
	await fs.writeFile(
		path.join(root, ".xcsh-plugin", "resources.json"),
		JSON.stringify({
			schema: "schema/s.json",
			template: "assets/t.xlsx",
			engine: { runtime: "bun", entry: "engine/cli.ts", commands: ["validate"] },
		}),
	);
	await fs.writeFile(path.join(root, "schema", "s.json"), `{"title":"x"}`);
	await fs.writeFile(path.join(root, "engine", "cli.ts"), `console.log("hi")`);
	// A binary resource: the first bytes of a real .xlsx (a zip container), including a
	// NUL, so a UTF-8 read of it is lossy rather than merely ugly.
	await fs.mkdir(path.join(root, "assets"), { recursive: true });
	await fs.writeFile(path.join(root, "assets", "t.xlsx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe]));
	// Symlink inside the plugin root pointing outside it (for escape-via-symlink test).
	await fs.symlink(os.tmpdir(), path.join(root, "escape"));
	roots = [{ plugin: "demo", version: "9.9.9", path: root }];
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe("PluginResolver", () => {
	const resolver = () => createPluginResolver(async () => roots);

	test("schema returns application/json with a sourcePath inside the plugin root", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/schema"));
		expect(r.contentType).toBe("application/json");
		expect(r.content).toContain(`"title"`);
		expect(r.sourcePath).toBe(path.join(root, "schema", "s.json"));
	});

	test("contract returns the manifest verbatim with a sourcePath", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/contract"));
		expect(r.contentType).toBe("application/json");
		expect(JSON.parse(r.content).schema).toBe("schema/s.json");
		expect(r.sourcePath).toBe(path.join(root, ".xcsh-plugin", "resources.json"));
	});

	test("file/<relpath> resolves an arbitrary root-relative file", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/file/engine/cli.ts"));
		expect(r.sourcePath).toBe(path.join(root, "engine", "cli.ts"));
		expect(r.content).toContain("hi");
	});

	test("file/<relpath> resolves a plugin directory for bash operands", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/file/schema/"));
		expect(r.contentType).toBe("application/json");
		expect(JSON.parse(r.content)).toEqual({ directory: true });
		expect(r.sourcePath).toBe(path.join(root, "schema"));
	});

	test("engine returns the resolved entry path", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/engine"));
		const body = JSON.parse(r.content);
		expect(body.entryPath).toBe(path.join(root, "engine", "cli.ts"));
		expect(r.sourcePath).toBe(path.join(root, "engine", "cli.ts"));
	});

	test("uninstalled plugin throws listing installed names", async () => {
		await expect(resolver().resolve(u("xcsh://plugin/nope/schema"))).rejects.toThrow(/not installed/i);
	});

	test("path traversal throws", async () => {
		await expect(resolver().resolve(u("xcsh://plugin/demo/file/../../etc/hosts"))).rejects.toThrow(/traversal/i);
	});

	test("resolves purely from the injected getPluginRoots (no dependency on external flags)", async () => {
		// Flag-independence at the sdk layer is guaranteed by listXcshPluginRoots not consulting enableXcshPlugins.
		const r = await createPluginResolver(async () => roots).resolve(u("xcsh://plugin/demo"));
		expect(JSON.parse(r.content).name).toBe("demo");
	});

	test("rejects escape via a symlink inside the plugin root", async () => {
		await expect(resolver().resolve(u("xcsh://plugin/demo/file/escape/x"))).rejects.toThrow(/traversal/i);
	});
});

describe("optional resources manifest", () => {
	test("summarizes plugin identity when resources.json is absent", async () => {
		const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-summary-PK-"));
		try {
			await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
			await fs.writeFile(
				path.join(pluginRoot, ".xcsh-plugin", "plugin.json"),
				JSON.stringify({ name: "Azure", description: "Azure cloud operations" }),
			);
			const summary = await createPluginResolver(async () => [
				{ plugin: "azure", version: "3.0.0", path: pluginRoot },
			]).resolve(u("xcsh://plugin/azure"));
			expect(JSON.parse(summary.content)).toEqual({
				id: "azure",
				name: "Azure",
				description: "Azure cloud operations",
				version: "3.0.0",
				hasResourcesManifest: false,
				resourcesManifestStatus: "absent",
				resources: [],
			});
		} finally {
			await fs.rm(pluginRoot, { recursive: true, force: true });
		}
	});

	test("reports valid resources deterministically and resolves an engine-only manifest", async () => {
		const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-engine-PK-"));
		try {
			await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
			await fs.mkdir(path.join(pluginRoot, "engine"), { recursive: true });
			await fs.writeFile(path.join(pluginRoot, ".xcsh-plugin", "plugin.json"), JSON.stringify({ name: "Engine" }));
			await fs.writeFile(
				path.join(pluginRoot, ".xcsh-plugin", "resources.json"),
				JSON.stringify({ zeta: "z.txt", engine: { runtime: "bun", entry: "engine/main.ts" }, alpha: "a.txt" }),
			);
			await fs.writeFile(path.join(pluginRoot, "engine", "main.ts"), "export {};\n");
			const resolver = createPluginResolver(async () => [{ plugin: "engine", version: "1.2.3", path: pluginRoot }]);
			const summary = JSON.parse((await resolver.resolve(u("xcsh://plugin/engine"))).content);
			expect(summary.hasResourcesManifest).toBe(true);
			expect(summary.resourcesManifestStatus).toBe("valid");
			expect(summary.resources).toEqual(["alpha", "engine", "zeta"]);
			expect(summary).not.toHaveProperty("resourcesManifestDiagnostic");
			await fs.writeFile(
				path.join(pluginRoot, ".xcsh-plugin", "resources.json"),
				JSON.stringify({ engine: { runtime: "bun", entry: "engine/main.ts" } }),
			);
			const engineOnlySummary = JSON.parse((await resolver.resolve(u("xcsh://plugin/engine"))).content);
			expect(engineOnlySummary.resources).toEqual(["engine"]);
			const engine = JSON.parse((await resolver.resolve(u("xcsh://plugin/engine/engine"))).content);
			expect(engine.entryPath).toBe(path.join(pluginRoot, "engine", "main.ts"));
		} finally {
			await fs.rm(pluginRoot, { recursive: true, force: true });
		}
	});

	test("preserves identity for a malformed manifest and sanitizes its diagnostic", async () => {
		const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-invalid-PK-"));
		try {
			await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
			await fs.writeFile(path.join(pluginRoot, ".xcsh-plugin", "plugin.json"), JSON.stringify({ name: "GitHub" }));
			await fs.writeFile(path.join(pluginRoot, ".xcsh-plugin", "resources.json"), '{"secret":"do-not-echo"');
			const resolver = createPluginResolver(async () => [{ plugin: "github", version: "2.0.3", path: pluginRoot }]);
			const content = (await resolver.resolve(u("xcsh://plugin/github"))).content;
			const summary = JSON.parse(content);
			expect(summary.name).toBe("GitHub");
			expect(summary.hasResourcesManifest).toBe(true);
			expect(summary.resourcesManifestStatus).toBe("invalid");
			expect(summary.resources).toEqual([]);
			expect(summary.resourcesManifestDiagnostic).toBe("Invalid .xcsh-plugin/resources.json: malformed JSON");
			expect(content).not.toContain("do-not-echo");
		} finally {
			await fs.rm(pluginRoot, { recursive: true, force: true });
		}
	});

	test("keeps contract, engine, and named-resource routes strict while file remains independent", async () => {
		const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-strict-PK-"));
		try {
			await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
			await fs.writeFile(path.join(pluginRoot, "readme.txt"), "available without a resource manifest");
			const resolver = createPluginResolver(async () => [{ plugin: "strict", version: "1.0.0", path: pluginRoot }]);
			for (const route of ["contract", "engine", "schema"]) {
				await expect(resolver.resolve(u(`xcsh://plugin/strict/${route}`))).rejects.toThrow(
					/Plugin strict has no resources manifest/,
				);
			}
			const file = await resolver.resolve(u("xcsh://plugin/strict/file/readme.txt"));
			expect(file.content).toContain("available without");

			await fs.writeFile(path.join(pluginRoot, ".xcsh-plugin", "resources.json"), "not-json");
			for (const route of ["contract", "engine", "schema"]) {
				await expect(resolver.resolve(u(`xcsh://plugin/strict/${route}`))).rejects.toThrow(
					/Plugin strict has an invalid resources manifest/,
				);
			}
		} finally {
			await fs.rm(pluginRoot, { recursive: true, force: true });
		}
	});

	test("keeps index and selected summary manifest status in agreement", async () => {
		const absentRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-index-absent-PK-"));
		const validRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-index-valid-PK-"));
		const invalidRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-index-invalid-PK-"));
		try {
			for (const pluginRoot of [absentRoot, validRoot, invalidRoot]) {
				await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
			}
			await fs.writeFile(path.join(validRoot, ".xcsh-plugin", "resources.json"), "{}");
			await fs.writeFile(path.join(invalidRoot, ".xcsh-plugin", "resources.json"), "[]");
			const rootsForIndex = [
				{ plugin: "absent", version: "1", path: absentRoot },
				{ plugin: "valid", version: "2", path: validRoot },
				{ plugin: "invalid", version: "3", path: invalidRoot },
			];
			const resolver = createPluginResolver(async () => rootsForIndex);
			const index = JSON.parse((await resolver.resolve(u("xcsh://plugin"))).content);
			expect(index).toEqual([
				{ name: "absent", version: "1", hasResourcesManifest: false, resourcesManifestStatus: "absent" },
				{ name: "valid", version: "2", hasResourcesManifest: true, resourcesManifestStatus: "valid" },
				{ name: "invalid", version: "3", hasResourcesManifest: true, resourcesManifestStatus: "invalid" },
			]);
			for (const entry of index) {
				const summary = JSON.parse((await resolver.resolve(u(`xcsh://plugin/${entry.name}`))).content);
				expect(summary.hasResourcesManifest).toBe(entry.hasResourcesManifest);
				expect(summary.resourcesManifestStatus).toBe(entry.resourcesManifestStatus);
			}
		} finally {
			await Promise.all(
				[absentRoot, validRoot, invalidRoot].map(pluginRoot => fs.rm(pluginRoot, { recursive: true, force: true })),
			);
		}
	});

	test("uses only the selected root and canonical metadata fallback", async () => {
		const selectedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-selected-PK-"));
		const shadowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-shadowed-PK-"));
		try {
			for (const pluginRoot of [selectedRoot, shadowedRoot]) {
				await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
			}
			await fs.writeFile(path.join(selectedRoot, ".xcsh-plugin", "plugin.json"), "not-json");
			await fs.writeFile(
				path.join(selectedRoot, "package.json"),
				JSON.stringify({ xcsh: { name: "Selected package", description: "fallback metadata" } }),
			);
			await fs.writeFile(
				path.join(shadowedRoot, ".xcsh-plugin", "plugin.json"),
				JSON.stringify({ name: "Shadowed root" }),
			);
			await fs.writeFile(path.join(shadowedRoot, ".xcsh-plugin", "resources.json"), '{"schema":"s.json"}');
			const resolver = createPluginResolver(async () => [
				{ plugin: "same", version: "2.0.0", path: selectedRoot },
				{ plugin: "same", version: "1.0.0", path: shadowedRoot },
			]);
			const summary = JSON.parse((await resolver.resolve(u("xcsh://plugin/same"))).content);
			expect(summary).toMatchObject({
				id: "same",
				name: "Selected package",
				description: "fallback metadata",
				version: "2.0.0",
				hasResourcesManifest: false,
				resourcesManifestStatus: "absent",
			});
		} finally {
			await Promise.all(
				[selectedRoot, shadowedRoot].map(pluginRoot => fs.rm(pluginRoot, { recursive: true, force: true })),
			);
		}
	});
});

/**
 * A plugin may declare a binary resource — the MEDDPICC plugin ships a 91 KB .xlsx
 * template. Reading one as UTF-8 corrupts it, and no consumer wants 91 KB of mangled
 * text in a prompt anyway. What a caller actually needs is where the file is, so it can
 * be copied or opened with a tool that understands the format.
 */
describe("binary resources", () => {
	const resolver = () => createPluginResolver(async () => roots);

	test("a declared binary resource reports its location and size instead of its bytes", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/template"));
		expect(r.contentType).toBe("application/json");
		const meta = JSON.parse(r.content) as { path: string; bytes: number; binary: boolean };
		expect(meta.binary).toBe(true);
		expect(meta.bytes).toBe(7);
		expect(meta.path).toBe(path.join(root, "assets", "t.xlsx"));
		expect(r.sourcePath).toBe(path.join(root, "assets", "t.xlsx"));
	});

	test("the raw bytes never appear in the content", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/template"));
		// A UTF-8 read of this file yields "PK\u0003\u0004\u0000\ufffd\ufffd".
		expect(r.content.startsWith("PK")).toBe(false);
		expect(r.content).not.toContain("\u0000");
	});

	test("the file/<relpath> route treats the same file as binary too", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/file/assets/t.xlsx"));
		const meta = JSON.parse(r.content) as { binary: boolean; bytes: number };
		expect(meta.binary).toBe(true);
		expect(meta.bytes).toBe(7);
	});

	test("text resources are unaffected — schema still returns its contents", async () => {
		const r = await resolver().resolve(u("xcsh://plugin/demo/schema"));
		expect(r.content).toContain(`"title"`);
	});

	test("a missing binary resource still throws rather than reporting a phantom file", async () => {
		await fs.writeFile(
			path.join(root, ".xcsh-plugin", "resources.json"),
			JSON.stringify({ schema: "schema/s.json", template: "assets/gone.xlsx" }),
		);
		await expect(resolver().resolve(u("xcsh://plugin/demo/template"))).rejects.toThrow(/not found/i);
		// Restore the manifest for any later test in this file.
		await fs.writeFile(
			path.join(root, ".xcsh-plugin", "resources.json"),
			JSON.stringify({
				schema: "schema/s.json",
				template: "assets/t.xlsx",
				engine: { runtime: "bun", entry: "engine/cli.ts", commands: ["validate"] },
			}),
		);
	});
});
