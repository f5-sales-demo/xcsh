import { expect, test } from "bun:test";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { RemoteSession } from "../../src/remote-control/session";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test.each([
	{ kind: "command", finalProgress: false },
	{ kind: "fileChange", finalProgress: false },
	{ kind: "command", finalProgress: true },
	{ kind: "fileChange", finalProgress: true },
] as const)(
	"attachment during active work preserves the running execution: %j",
	async ({ kind, finalProgress }) => {
		const begin = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const advance = Promise.withResolvers<void>();
		const progressed = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const execution = (output: string, done = false) =>
			kind === "command"
				? {
						kind,
						command: "fixture",
						cwd: "/tmp/active-owner",
						status: done ? "completed" : "inProgress",
						aggregatedOutput: output,
						exitCode: done ? 0 : null,
						durationMs: done ? 20 : null,
						processId: null,
					}
				: {
						kind,
						status: done ? "completed" : "inProgress",
						changes: [{ path: "/tmp/active-owner/file.txt", type: "add", content: output }],
					};
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		const auth = await AuthStorage.create(":memory:");
		auth.setRuntimeApiKey(model.provider, "fixture-key");
		let executions = 0;
		let iteration = 0;
		const agent = new Agent({
			getApiKey: () => "fixture-key",
			initialState: {
				model,
				systemPrompt: "Test",
				messages: [],
				tools: [
					{
						name: "fixture",
						label: "Fixture",
						executionKind: kind,
						description: "Fixture tool",
						parameters: Type.Object({}),
						execute: async (_id, _args, _signal, onUpdate) => {
							executions++;
							await begin.promise;
							onUpdate?.({
								content: [{ type: "text", text: "first" }],
								details: { execution: execution("first", finalProgress), outputDelta: "first" },
							});
							entered.resolve();
							await advance.promise;
							onUpdate?.({
								content: [{ type: "text", text: "firstsecond" }],
								details: { execution: execution("firstsecond", finalProgress), outputDelta: "second" },
							});
							progressed.resolve();
							await finish.promise;
							return {
								content: [{ type: "text", text: "firstsecond" }],
								details: { execution: execution("firstsecond", true) },
							};
						},
					},
				],
			},
			streamFn: () => {
				const stream = new AssistantMessageEventStream();
				const first = ++iteration === 1;
				const message: AssistantMessage = {
					role: "assistant",
					content: first
						? [{ type: "toolCall", id: "owner-call", name: "fixture", arguments: {} }]
						: [{ type: "text", text: "Owner finished", phase: "final_answer" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
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
			},
		});
		const manager = SessionManager.inMemory("/tmp/active-owner");
		const session = new AgentSession({
			agent,
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
		});
		const observed = Promise.withResolvers<void>();
		session.subscribe(event => {
			if (event.type === "tool_execution_update") observed.resolve();
			if (event.type === "tool_execution_start") started.resolve();
		});
		let remote: RemoteSession | undefined;
		const task = session.prompt("Use the fixture");
		const events: { method: string; params: Record<string, unknown> }[] = [];
		try {
			await started.promise;
			remote = new RemoteSession(session);
			const initialItem = remote
				.history()[0]
				.items.find(item => item.type === (kind === "command" ? "commandExecution" : "fileChange"));
			expect(initialItem?.status).toBe("inProgress");
			remote.dispose();
			begin.resolve();
			await entered.promise;
			await observed.promise;
			remote = new RemoteSession(session);
			const expectedType = kind === "command" ? "commandExecution" : "fileChange";
			const item = remote.history()[0].items.find(item => item.type === expectedType);
			expect(item).toBeDefined();
			if (!item) throw new Error("Missing active execution");
			expect(item.status).toBe("inProgress");
			if (kind === "command") expect(item.aggregatedOutput).toBe("first");
			else
				expect(item.changes).toEqual([
					{ path: "/tmp/active-owner/file.txt", kind: { type: "add" }, diff: "first" },
				]);
			const timeline = (await remote.call("timeline", "thread/timeline/list", { threadId: session.sessionId })) as {
				data: { type: string; item?: Record<string, unknown> }[];
			};
			expect(timeline.data.find(row => row.item?.id === item.id)?.item).toEqual(item);
			const initial = remote.history();
			remote.dispose();
			remote = new RemoteSession(session);
			expect(remote.history()).toEqual(initial);
			remote.subscribe(event => events.push(event));
			advance.resolve();
			await progressed.promise;
			// Allow the AgentSession subscriber delivery to finish.
			await Bun.sleep(0);
			expect(remote.history()[0].items.find(value => value.id === item.id)?.status).toBe("inProgress");
			expect(events.filter(event => event.method === "item/completed")).toHaveLength(0);
			if (kind === "command")
				expect(
					events
						.filter(event => event.method === "item/commandExecution/outputDelta")
						.map(event => event.params.delta),
				).toEqual(["second"]);
			else
				expect(
					events
						.filter(event => event.method === "item/fileChange/patchUpdated")
						.map(event => event.params.changes),
				).toEqual([[{ path: "/tmp/active-owner/file.txt", kind: { type: "add" }, diff: "firstsecond" }]]);
			finish.resolve();
			await task;
			await manager.flush();
			expect(executions).toBe(1);
			expect(session.getActiveToolExecutions()).toEqual([]);
			const history = remote.history();
			const completed = history[0].items.find(value => value.id === item.id);
			expect(completed?.status).toBe("completed");
			expect(
				events
					.filter(event => event.method === "item/completed" && (event.params.item as any).id === item.id)
					.map(event => event.params.item),
			).toEqual([completed]);
			remote.dispose();
			remote = new RemoteSession(session);
			expect(remote.history()).toEqual(history);
		} finally {
			begin.resolve();
			advance.resolve();
			finish.resolve();
			await task;
			remote?.dispose();
			await session.dispose();
			auth.close();
		}
	},
	10000,
);
