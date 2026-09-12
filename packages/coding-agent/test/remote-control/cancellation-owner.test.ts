import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Settings } from "../../src/config/settings";
import { type Notification, RemoteSession } from "../../src/remote-control/session";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";

test.each([false, true])(
	"cancelled background execution persists without another model turn, retry=%s",
	async retryFlush => {
		const background = true;
		const cwd = await mkdtemp("/tmp/xcsh-command-stream-");
		const auth = await AuthStorage.create(":memory:");
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		auth.setRuntimeApiKey(model.provider, "fixture-key");
		const { session } = await createAgentSession({
			cwd,
			agentDir: join(cwd, "agent"),
			authStorage: auth,
			model,
			toolNames: ["bash", "cancel_job"],
			settings: Settings.isolated({
				"async.enabled": true,
				"compaction.enabled": false,
				"bash.autoBackground.enabled": false,
				"bashInterceptor.enabled": false,
			}),
			disableExtensionDiscovery: true,
			skills: [],
			rules: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});
		let calls = 0;
		session.agent.streamFn = () => {
			const stream = new AssistantMessageEventStream();
			const first = ++calls === 1;
			const message: AssistantMessage = {
				role: "assistant",
				content: first
					? [
							{
								type: "toolCall",
								id: "shell-stream",
								name: "bash",
								arguments: { command: "printf first; sleep 30; printf second", async: background },
							},
						]
					: [{ type: "text", text: "Done" }],
				api: model.api,
				model: model.id,
				provider: model.provider,
				stopReason: first ? "toolUse" : "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(() => {
				stream.push({ type: "start", partial: { ...message, content: [] } });
				stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
			});
			return stream;
		};
		let flushAttempts = 0;
		const originalFlush = session.sessionManager.flush.bind(session.sessionManager);
		const flush = spyOn(session.sessionManager, "flush").mockImplementation(async () => {
			if (
				retryFlush &&
				session.sessionManager
					.getBranch()
					.some(entry => entry.type === "custom" && entry.customType === "async-execution") &&
				++flushAttempts === 1
			)
				throw new Error("Fixture settlement persistence retry");
			await originalFlush();
		});
		const remote = new RemoteSession(session);
		const events: Notification[] = [];
		const completed = Promise.withResolvers<Record<string, unknown>>();
		const firstTurn = Promise.withResolvers<void>();
		remote.subscribe(event => {
			events.push(event);
			if (event.method === "turn/completed") firstTurn.resolve();
			if (event.method === "item/completed" && (event.params.item as any).type === "commandExecution")
				completed.resolve(event.params.item as Record<string, unknown>);
		});
		try {
			await remote.call("stream", "turn/start", {
				threadId: session.sessionId,
				input: [{ type: "text", text: "Run fixture" }],
			});
			await firstTurn.promise;
			const toolResult = session.sessionManager
				.getBranch()
				.find(value => value.type === "message" && value.message.role === "toolResult");
			if (toolResult?.type !== "message" || toolResult.message.role !== "toolResult")
				throw new Error("Missing job start");
			const jobId = (toolResult.message.details as any).async.jobId;
			await session.getToolByName("cancel_job")!.execute("cancel", { job_id: jobId });
			const item = await Promise.race([
				completed.promise,
				Bun.sleep(1500).then(() => {
					throw new Error("Cancellation was not recorded");
				}),
			]);
			await session.sessionManager.flush();
			expect(item).toMatchObject({ status: "failed", exitCode: null });
			expect(String(item.aggregatedOutput)).not.toContain("second");
			expect(calls).toBe(2);
			expect(
				session.sessionManager
					.getBranch()
					.filter(value => value.type === "custom" && value.customType === "async-execution"),
			).toHaveLength(1);
			expect(
				remote
					.history()
					.flatMap(turn => turn.items)
					.find(value => value.id === item.id),
			).toEqual(item);
			expect(
				events.filter(event => event.method === "item/completed" && (event.params.item as any).id === item.id),
			).toHaveLength(1);
		} finally {
			remote.dispose();
			await session.dispose();
			flush.mockRestore();
			auth.close();
			await rm(cwd, { recursive: true, force: true });
		}
	},
	10000,
);
