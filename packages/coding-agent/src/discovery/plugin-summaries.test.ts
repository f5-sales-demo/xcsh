import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPluginSummary } from "./helpers";

async function mkRoot(files: Record<string, unknown>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "xps-"));
	for (const [rel, content] of Object.entries(files)) {
		const p = join(dir, rel);
		await mkdir(join(p, ".."), { recursive: true });
		await writeFile(p, JSON.stringify(content));
	}
	return dir;
}

describe("readPluginSummary", () => {
	test("reads name+description from .xcsh-plugin/plugin.json", async () => {
		const path = await mkRoot({
			".xcsh-plugin/plugin.json": { name: "meddpicc", description: "MEDDPICC framework" },
		});
		expect(await readPluginSummary({ plugin: "meddpicc", path })).toEqual({
			name: "meddpicc",
			description: "MEDDPICC framework",
		});
	});
	test("falls back to package.json xcsh field", async () => {
		const path = await mkRoot({ "package.json": { xcsh: { name: "foo", description: "Foo tool" } } });
		expect(await readPluginSummary({ plugin: "foo", path })).toEqual({ name: "foo", description: "Foo tool" });
	});
	test("no manifest → name from root.plugin, empty description", async () => {
		const path = await mkRoot({});
		expect(await readPluginSummary({ plugin: "bare", path })).toEqual({ name: "bare", description: "" });
	});
	test("manifest without name → falls back to root.plugin", async () => {
		const path = await mkRoot({ ".xcsh-plugin/plugin.json": { description: "desc only" } });
		expect(await readPluginSummary({ plugin: "baz", path })).toEqual({ name: "baz", description: "desc only" });
	});
});
