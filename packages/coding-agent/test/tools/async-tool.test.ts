import { describe, expect, it } from "bun:test";
import { AsyncJobManager } from "../../src/async/job-manager";
import { Settings } from "../../src/config/settings";
import type { Tool, ToolSession } from "../../src/tools";
import { wrapAsyncTool } from "../../src/tools/async-tool";

describe("opt-in asynchronous tool execution", () => {
	it("correlates rewrapped calls with their existing job and cancels without success delivery", async () => {
		let executions = 0;
		const manager = new AsyncJobManager({
			onJobComplete: () => {
				throw new Error("Cancelled job delivered as success");
			},
		});
		const tool = {
			name: "synthetic",
			label: "Synthetic",
			async: true,
			execute: async (_id: string, _args: unknown, signal: AbortSignal) => {
				executions++;
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
				);
				return { content: [] };
			},
		} as unknown as Tool;
		const session = {
			settings: Settings.isolated({ "async.enabled": true }),
			asyncJobManager: manager,
			getSessionId: () => "synthetic-session",
		} as ToolSession;
		const first = await wrapAsyncTool(tool, session).execute("same-call", { value: 1 });
		const second = await wrapAsyncTool(tool, session).execute("same-call", { value: 1 });
		expect(first.details.jobId).toBe(second.details.jobId);
		expect(executions).toBe(1);
		expect(manager.cancel(first.details.jobId)).toBe(true);
		await manager.getJob(first.details.jobId)?.promise;
		expect(manager.getJob(first.details.jobId)?.status).toBe("cancelled");
		await manager.dispose();
	});
	it("preserves ordinary execution and uses owned delivery for an opted-in tool", async () => {
		const pending = Promise.withResolvers<void>();
		let executions = 0;
		const tool = {
			name: "synthetic",
			label: "Synthetic",
			execute: async () => {
				executions++;
				await pending.promise;
				return { content: [{ type: "text", text: "complete" }], details: {} };
			},
		} as unknown as Tool;
		const delivered: string[] = [];
		const manager = new AsyncJobManager({
			onJobComplete: (_id, text) => {
				delivered.push(text);
			},
		});
		const session = {
			settings: Settings.isolated({ "async.enabled": true }),
			asyncJobManager: manager,
		} as ToolSession;
		expect(wrapAsyncTool(tool, session)).toBe(tool);
		const wrapped = wrapAsyncTool({ ...tool, async: true }, session);
		const result = await wrapped.execute("synthetic-call", {});
		expect(result.details).toMatchObject({ status: "running" });
		expect(executions).toBe(1);
		pending.resolve();
		await manager.getJob((result.details as { jobId: string }).jobId)?.promise;
		await Bun.sleep(10);
		expect(delivered[0]).toContain("complete");
		manager.dispose();
	});
});
