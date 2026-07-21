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
			engine: { runtime: "bun", entry: "engine/cli.ts", commands: ["validate"] },
		}),
	);
	await fs.writeFile(path.join(root, "schema", "s.json"), `{"title":"x"}`);
	await fs.writeFile(path.join(root, "engine", "cli.ts"), `console.log("hi")`);
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

	test("resolution ignores prompt-gating (works with any roots source)", async () => {
		// getPluginRoots is the only source; no dependency on enableXcshPlugins.
		const r = await createPluginResolver(async () => roots).resolve(u("xcsh://plugin/demo"));
		expect(JSON.parse(r.content).name).toBe("demo");
	});

	test("rejects escape via a symlink inside the plugin root", async () => {
		await expect(resolver().resolve(u("xcsh://plugin/demo/file/escape/x"))).rejects.toThrow(/traversal/i);
	});
});
