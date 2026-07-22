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
