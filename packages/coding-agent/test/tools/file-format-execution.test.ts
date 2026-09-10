import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { createLspWritethrough } from "../../src/lsp";
import * as clients from "../../src/lsp/clients";
import * as config from "../../src/lsp/config";
import type { ToolSession } from "../../src/tools";
import { captureFileExecution } from "../../src/tools/file-mutations";
import { WriteTool } from "../../src/tools/write";

const dirs: string[] = [];

beforeEach(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true });
});
afterEach(async () => {
	mock.restore();
	for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true });
	_resetSettingsForTest();
});
async function setup(format: (path: string, content: string) => Promise<string>) {
	const cwd = await mkdtemp(join(tmpdir(), "xcsh-file-format-"));
	dirs.push(cwd);
	spyOn(config, "loadConfig").mockReturnValue({ servers: {}, idleTimeoutMs: undefined });
	spyOn(config, "getServersForFile").mockReturnValue([["fixture", { createClient: () => ({}) } as never]]);
	spyOn(clients, "getLinterClient").mockReturnValue({ format, lint: async () => [] } as never);
	return cwd;
}
test("a batch records formatter mutations to earlier files under the call that flushes them", async () => {
	const cwd = await setup(async (_path, content) => content.replace("=", " = "));
	const session: ToolSession = {
		cwd,
		hasUI: false,
		enableLsp: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "lsp.formatOnWrite": true, "lsp.diagnosticsOnWrite": false }),
	};
	const tool = new WriteTool(session);
	const a = join(cwd, "a.ts");
	const b = join(cwd, "b.ts");
	const toolCalls = [
		{ id: "a", name: "write", arguments: { path: a, content: "const a=1;\n" } },
		{ id: "b", name: "write", arguments: { path: b, content: "const b=2;\n" } },
	];
	const first = await tool.execute("a", toolCalls[0].arguments, undefined, undefined, {
		toolCall: { batchId: "format-fixture", index: 0, toolCalls },
	} as never);
	expect(first.details?.execution?.changes).toEqual([{ path: a, type: "add", content: "const a=1;\n" }]);
	const second = await tool.execute("b", toolCalls[1].arguments, undefined, undefined, {
		toolCall: { batchId: "format-fixture", index: 1, toolCalls },
	} as never);
	expect(second.details?.execution?.changes).toEqual([
		{ path: a, type: "update", unifiedDiff: "@@ -1 +1 @@\n-const a=1;\n+const a = 1;\n", movePath: null },
		{ path: b, type: "add", content: "const b = 2;\n" },
	]);
	expect(await readFile(a, "utf8")).toBe("const a = 1;\n");
	expect(await readFile(b, "utf8")).toBe("const b = 2;\n");
});

test("a formatter returning after cancellation cannot mutate a settled file execution", async () => {
	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<string>();
	const cwd = await setup(async () => {
		started.resolve();
		return finish.promise;
	});
	const path = join(cwd, "late.ts");
	await writeFile(path, "before\n");
	const controller = new AbortController();
	const write = createLspWritethrough(cwd, { enableFormat: true, enableDiagnostics: false });
	const running = captureFileExecution(async () => {
		await write(path, "requested\n", controller.signal);
		return { content: [], details: {} };
	});
	await started.promise;
	controller.abort();
	const result = await running;
	expect(result.details?.execution?.changes).toEqual([
		{ path, type: "update", unifiedDiff: "@@ -1 +1 @@\n-before\n+requested\n", movePath: null },
	]);
	finish.resolve("late formatted\n");
	await Bun.sleep(25);
	expect(await readFile(path, "utf8")).toBe("requested\n");
});

test("cancellation joins an already-started disk write before exposing its final execution facts", async () => {
	const firstStarted = Promise.withResolvers<void>();
	const releaseFirst = Promise.withResolvers<void>();
	const cwd = await setup(async () => "formatted\n");
	const path = join(cwd, "pending.ts");
	await writeFile(path, "before\n");
	let writes = 0;
	const file = {
		write: async (content: string) => {
			if (++writes === 1) {
				firstStarted.resolve();
				await releaseFirst.promise;
			}
			await writeFile(path, content);
			return Buffer.byteLength(content);
		},
	};
	const controller = new AbortController();
	const write = createLspWritethrough(cwd, { enableFormat: true, enableDiagnostics: false });
	let settled = false;
	const running = captureFileExecution(async () => {
		await write(path, "requested\n", controller.signal, file as never);
		return { content: [], details: {} };
	}).finally(() => {
		settled = true;
	});
	await firstStarted.promise;
	controller.abort();
	await Bun.sleep(20);
	expect(settled).toBe(false);
	releaseFirst.resolve();
	const result = await running;
	expect(result.details?.execution?.changes).toEqual([
		{ path, type: "update", unifiedDiff: "@@ -1 +1 @@\n-before\n+requested\n", movePath: null },
	]);
	expect(await readFile(path, "utf8")).toBe("requested\n");
});
