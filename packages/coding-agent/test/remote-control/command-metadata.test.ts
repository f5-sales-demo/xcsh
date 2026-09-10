import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { AsyncJobManager } from "../../src/async";
import { Settings } from "../../src/config/settings";
import * as executor from "../../src/exec/bash-executor";
import { BashTool } from "../../src/tools/bash";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});
function result(exitCode: number | undefined, cancelled = false) {
	return {
		output: "Fixture output\n",
		exitCode,
		cancelled,
		truncated: false,
		totalLines: 1,
		totalBytes: 15,
		outputLines: 1,
		outputBytes: 15,
	};
}
async function fixture(asyncJobManager?: AsyncJobManager, autoBackground = false) {
	const cwd = await mkdtemp("/tmp/xcsh-command-metadata-");
	cleanup.push(() => rm(cwd, { recursive: true, force: true }));
	const tool = new BashTool({
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({
			"bash.autoBackground.enabled": autoBackground,
			"bashInterceptor.enabled": false,
			"async.enabled": true,
		}),
		asyncJobManager,
	});
	return { tool, cwd };
}

test.each([0, 7, undefined])(
	"command metadata retains actual exit status %s without parsing output",
	async exitCode => {
		const mock = spyOn(executor, "executeBash").mockImplementation(async () => result(exitCode));
		cleanup.push(() => mock.mockRestore());
		const f = await fixture();
		const outcome = await f.tool.execute("call-1", { command: "fixture-command" }).then(
			value => ({ error: false, value }),
			error => {
				expect(error).toBeInstanceOf(AgentToolError);
				return { error: true, value: error.result };
			},
		);
		expect(f.tool.executionKind).toBe("command");
		expect(outcome.error).toBe(exitCode !== 0);
		expect(outcome.value.details.execution).toMatchObject({
			kind: "command",
			command: "fixture-command",
			cwd: f.cwd,
			status: exitCode === 0 ? "completed" : "failed",
			exitCode: exitCode ?? null,
			aggregatedOutput: "Fixture output\n",
			processId: null,
		});
		expect(outcome.value.details.execution.durationMs).toBeGreaterThanOrEqual(0);
	},
);

test("cancelled command metadata does not turn a missing exit status into success", async () => {
	const mock = spyOn(executor, "executeBash").mockImplementation(async () => result(undefined, true));
	cleanup.push(() => mock.mockRestore());
	const f = await fixture();
	const signal = new AbortController();
	signal.abort();
	const error = await f.tool.execute("call-1", { command: "fixture-command" }, signal.signal).catch(error => error);
	expect(error.name).toBe("ToolAbortError");
	expect(error.result.details.execution).toMatchObject({
		status: "failed",
		exitCode: null,
		aggregatedOutput: "Fixture output\n",
	});
});

test("streamed command metadata carries the actual resolved working directory", async () => {
	const mock = spyOn(executor, "executeBash").mockImplementation(async (_command, options) => {
		options?.onChunk?.("Fixture output\n");
		return result(0);
	});
	cleanup.push(() => mock.mockRestore());
	const f = await fixture();
	const updates: any[] = [];
	await f.tool.execute("call-1", { command: `cd '${f.cwd}' && fixture-command` }, undefined, update =>
		updates.push(update),
	);
	expect(updates.at(-1).details.execution).toMatchObject({
		kind: "command",
		command: "fixture-command",
		cwd: f.cwd,
		status: "inProgress",
		exitCode: null,
		aggregatedOutput: "Fixture output\n",
	});
});

test.each([0, 7])("background command keeps structured final metadata for delivery: exit %s", async exitCode => {
	const release = Promise.withResolvers<void>();
	const mock = spyOn(executor, "executeBash").mockImplementation(async () => {
		await release.promise;
		return result(exitCode);
	});
	cleanup.push(() => mock.mockRestore());
	const delivered = Promise.withResolvers<any>();
	const manager = new AsyncJobManager({
		onJobComplete: async (_id, _text, job) => {
			delivered.resolve(job);
		},
	});
	const f = await fixture(manager);
	cleanup.push(async () => {
		release.resolve();
		await manager.dispose();
	});
	const started = await f.tool.execute("call-1", { command: "fixture-command", async: true });
	expect(started.details?.execution).toMatchObject({
		kind: "command",
		status: "inProgress",
		exitCode: null,
		cwd: f.cwd,
	});
	release.resolve();
	const job = await delivered.promise;
	expect(job.resultDetails.execution).toMatchObject({
		kind: "command",
		status: exitCode === 0 ? "completed" : "failed",
		exitCode,
		aggregatedOutput: "Fixture output\n",
	});
});

test("background command streams structured execution metadata before completion", async () => {
	const release = Promise.withResolvers<void>();
	const streamed = Promise.withResolvers<any>();
	const mock = spyOn(executor, "executeBash").mockImplementation(async (_command, options) => {
		options?.onChunk?.("Fixture output\n");
		await release.promise;
		return result(0);
	});
	cleanup.push(() => mock.mockRestore());
	const manager = new AsyncJobManager({ onJobComplete: async () => {} });
	const f = await fixture(manager);
	cleanup.push(async () => {
		release.resolve();
		await manager.dispose();
	});
	await f.tool.execute("call-stream", { command: "fixture-command", async: true }, undefined, update =>
		streamed.resolve(update),
	);
	const update = await streamed.promise;
	expect(update.details.execution).toMatchObject({
		kind: "command",
		status: "inProgress",
		aggregatedOutput: "Fixture output\n",
		exitCode: null,
		cwd: f.cwd,
	});
	expect(update.details.async.state).toBe("running");
});

test.each([false, true])(
	"executor exceptions preserve command facts without inventing an exit code: async=%s",
	async background => {
		const mock = spyOn(executor, "executeBash").mockImplementation(async (_command, options) => {
			options?.onChunk?.("Partial output\n");
			throw new Error("Fixture executor unavailable");
		});
		cleanup.push(() => mock.mockRestore());
		const delivered = Promise.withResolvers<any>();
		const manager = new AsyncJobManager({
			onJobComplete: async (_id, _text, job) => {
				delivered.resolve(job);
			},
		});
		const f = await fixture(manager);
		cleanup.push(async () => {
			await manager.dispose();
		});
		const outcome = await f.tool
			.execute("failed-executor", { command: "fixture-command", async: background })
			.catch(error => error);
		const execution = background
			? (await delivered.promise).resultDetails?.execution
			: outcome.result?.details.execution;
		expect(execution).toMatchObject({
			kind: "command",
			command: "fixture-command",
			cwd: f.cwd,
			status: "failed",
			aggregatedOutput: "Partial output\n",
			exitCode: null,
		});
	},
);

test("foreground auto-background waiting retains execution metadata without a background presentation marker", async () => {
	const mock = spyOn(executor, "executeBash").mockImplementation(async (_command, options) => {
		options?.onChunk?.("Fixture output\n");
		return result(0);
	});
	cleanup.push(() => mock.mockRestore());
	const manager = new AsyncJobManager({ onJobComplete: async () => {} });
	const f = await fixture(manager, true);
	cleanup.push(async () => {
		await manager.dispose();
	});
	const updates: any[] = [];
	await f.tool.execute("foreground-call", { command: "fixture-command" }, undefined, update => updates.push(update));
	expect(updates[0].details.execution).toMatchObject({
		status: "inProgress",
		command: "fixture-command",
		aggregatedOutput: "Fixture output\n",
	});
	expect(updates[0].details.async).toBeUndefined();
});
