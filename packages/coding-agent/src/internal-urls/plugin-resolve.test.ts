import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseInternalUrl } from "./parse";
import { createPluginResolver, type PluginRootLike } from "./plugin-resolve";
import type { InternalUrl } from "./types";

let root: string;
let roots: PluginRootLike[];

function u(input: string): InternalUrl {
	return parseInternalUrl(input) as InternalUrl;
}

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-resolve-"));
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
		expect(r.content).not.toContain("PK");
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
