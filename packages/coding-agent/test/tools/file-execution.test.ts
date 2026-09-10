import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unifiedDiff } from "@f5-sales-demo/pi-natives";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { type EditMode, EditTool } from "../../src/edit";
import type { ToolSession } from "../../src/tools";
import type { FileExecutionDetails } from "../../src/tools/execution-metadata";
import { WriteTool } from "../../src/tools/write";

const dirs: string[] = [];
beforeEach(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true });
});
afterEach(async () => {
	for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true });
	_resetSettingsForTest();
});
async function fixture(mode: EditMode) {
	const cwd = await mkdtemp(join(tmpdir(), "xcsh-native-file-"));
	dirs.push(cwd);
	const previous = Bun.env.PI_EDIT_VARIANT;
	try {
		Bun.env.PI_EDIT_VARIANT = mode;
		const session: ToolSession = {
			cwd,
			hasUI: false,
			enableLsp: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated(),
		};
		return { cwd, session, tool: new EditTool(session) };
	} finally {
		if (previous === undefined) delete Bun.env.PI_EDIT_VARIANT;
		else Bun.env.PI_EDIT_VARIANT = previous;
	}
}
for (const mode of ["replace", "patch", "hashline", "chunk"] as const) {
	test(`${mode} records the actual native edit independently of its display diff`, async () => {
		const { cwd, tool } = await fixture(mode);
		const path = join(cwd, "fixture.ts");
		const before = "const value = 1;\r\n";
		await writeFile(path, before);
		const entry =
			mode === "replace"
				? { path, old_text: "1", new_text: "2" }
				: mode === "patch"
					? { path, op: "update", diff: "@@\n-const value = 1;\n+const value = 2;" }
					: mode === "chunk"
						? { path, insert: { loc: "append", body: "const extra = 2;" } }
						: { path, loc: "append", content: "const extra = 2;" };
		const result = await tool.execute("file-fixture", { edits: [entry] } as never);
		const after = await readFile(path, "utf8");
		expect(after).not.toBe(before);
		expect(tool.executionKind).toBe("fileChange");
		expect((result.details as { execution: FileExecutionDetails }).execution).toEqual({
			kind: "fileChange",
			status: "completed",
			changes: [{ path, type: "update", unifiedDiff: unifiedDiff(before, after), movePath: null }],
		});
	});
}
for (const mode of ["patch", "hashline"] as const) {
	test(`${mode} retains deleted contents and a rename destination`, async () => {
		const { cwd, tool } = await fixture(mode);
		const path = join(cwd, "original.txt");
		const destination = join(cwd, "moved.txt");
		await writeFile(path, "original\n");
		const entry =
			mode === "patch"
				? { path, op: "update", rename: destination, diff: "@@\n-original\n+moved" }
				: { path, move: destination };
		const moved = await tool.execute("move", { edits: [entry] } as never);
		expect((moved.details as { execution: FileExecutionDetails }).execution.changes).toEqual([
			{
				path,
				type: "update",
				unifiedDiff: mode === "patch" ? "@@ -1 +1 @@\n-original\n+moved\n" : "",
				movePath: destination,
			},
		]);
		const deleted = await tool.execute("delete", {
			edits: [mode === "patch" ? { path: destination, op: "delete" } : { path: destination, delete: true }],
		} as never);
		expect((deleted.details as { execution: FileExecutionDetails }).execution.changes).toEqual([
			{ path: destination, type: "delete", content: mode === "patch" ? "moved\n" : "original\n" },
		]);
	});
}
test("partial multi-file failure retains only the completed native mutation", async () => {
	const { cwd, tool } = await fixture("replace");
	const path = join(cwd, "exists");
	await writeFile(path, "old\n");
	const result = await tool.execute("partial", {
		edits: [
			{ path, old_text: "old", new_text: "new" },
			{ path: join(cwd, "missing"), old_text: "old", new_text: "new" },
		],
	});
	expect((result.details as { execution: FileExecutionDetails }).execution).toEqual({
		kind: "fileChange",
		status: "failed",
		changes: [{ path, type: "update", unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n", movePath: null }],
	});
});

test("native write captures create and overwrite, preserving UTF-8 byte counts", async () => {
	const { cwd, session } = await fixture("replace");
	const tool = new WriteTool(session);
	const path = join(cwd, "written.txt");
	const input = { path, content: "Ω\n" };
	expect(tool.getExecutionKind(input)).toBe("fileChange");
	const created = await tool.execute("create", input);
	expect(created.details?.execution).toEqual({
		kind: "fileChange",
		status: "completed",
		changes: [{ path, type: "add", content: "Ω\n" }],
	});
	expect(created.content).toEqual([{ type: "text", text: `Successfully wrote 3 bytes to ${path}` }]);
	const updated = await tool.execute("overwrite", { path, content: "β\n" });
	expect(updated.details?.execution).toEqual({
		kind: "fileChange",
		status: "completed",
		changes: [{ path, type: "update", unifiedDiff: "@@ -1 +1 @@\n-Ω\n+β\n", movePath: null }],
	});
	expect(await readFile(path, "utf8")).toBe("β\n");
});

test("archive-entry and SQLite-row writes retain their dynamic tool presentation", async () => {
	const { session } = await fixture("replace");
	const tool = new WriteTool(session);
	expect(tool.getExecutionKind({ path: "archive.zip:entry.txt", content: "fixture" })).toBeUndefined();
	expect(tool.getExecutionKind({ path: "database.db:table", content: "fixture" })).toBeUndefined();
});
