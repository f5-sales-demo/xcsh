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

const cases = (["command", "fileChange", undefined] as const).flatMap(kind =>
	[false, true].flatMap(reattach =>
		(["phone", "terminal", "cancel", "decline"] as const).map(answer => ({ kind, reattach, answer })),
	),
);
test.each(cases)(
	"running tool prompts preserve ownership: %j",
	async ({ kind, reattach, answer }) => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		const auth = await AuthStorage.create(":memory:");
		auth.setRuntimeApiKey(model.provider, "fixture-key");
		const begin = Promise.withResolvers<void>(),
			opened = Promise.withResolvers<void>();
		let executions = 0,
			mutations = 0,
			iteration = 0;
		let session: AgentSession;
		const agent = new Agent({
			getApiKey: () => "fixture-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [
					{
						name: "fixture",
						label: "Fixture",
						description: "Fixture",
						executionKind: kind,
						parameters: Type.Object({}),
						execute: async id => {
							executions++;
							await begin.promise;
							const result = session.userInteractions.request(
								{ kind: "select", title: "Apply fixture change?", options: ["Yes", "No"], toolCallId: id },
								() => new Promise(() => {}),
							);
							opened.resolve();
							if ((await result) === "Yes") mutations++;
							return { content: [{ type: "text", text: "Finished" }], details: {} };
						},
					},
				],
			},
			streamFn: () => {
				const first = ++iteration === 1;
				const message: AssistantMessage = {
					role: "assistant",
					content: first
						? [{ type: "toolCall", id: "owner-call", name: "fixture", arguments: {} }]
						: [{ type: "text", text: "Done" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					timestamp: Date.now(),
					stopReason: first ? "toolUse" : "stop",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				};
				const stream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: { ...message, content: [] } });
					stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
				});
				return stream;
			},
		});
		const manager = SessionManager.inMemory();
		session = new AgentSession({
			agent,
			toolRegistry: new Map(agent.state.tools.map(tool => [tool.name, tool])),
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
		});
		let remote = new RemoteSession(session);
		const task = session.prompt("Use fixture");
		try {
			begin.resolve();
			await opened.promise;
			if (reattach) {
				await remote.close();
				remote = new RemoteSession(session);
			}
			const expectedType =
				kind === "command" ? "commandExecution" : kind === "fileChange" ? "fileChange" : "dynamicToolCall";
			const item = remote
				.history()
				.flatMap(turn => turn.items)
				.find(item => String(item.id).endsWith(":tool:owner-call"));
			expect(item?.type).toBe(expectedType);
			expect(item?.status).toBe("inProgress");
			expect(remote.pendingRequests()).toHaveLength(1);
			const request = remote.pendingRequests()[0];
			expect(request.params.itemId).toBe(item!.id);
			expect(mutations).toBe(0);
			const respond = () =>
				remote.call(`answer-${answer}`, "session/interaction/respond", {
					threadId: session.sessionId,
					requestId: request.id,
					response: { answers: { [request.id]: { answers: [answer === "decline" ? "No" : "Yes"] } } },
				});
			if (answer === "phone" || answer === "decline") expect(await respond()).toEqual({ accepted: true });
			else if (answer === "terminal") expect(session.userInteractions.respond(request.id, "Yes")).toBe(true);
			else session.userInteractions.cancelAll();
			await task;
			expect(executions).toBe(1);
			expect(mutations).toBe(answer === "cancel" || answer === "decline" ? 0 : 1);
			expect(remote.pendingRequests()).toEqual([]);
			expect(
				await remote.call("late-answer", "session/interaction/respond", {
					threadId: session.sessionId,
					requestId: request.id,
					response: { answers: { [request.id]: { answers: ["Yes"] } } },
				}),
			).toEqual({ accepted: false });
			const stale = session.userInteractions.request(
				{ kind: "input", title: "Completed tool prompt", toolCallId: "owner-call" },
				() => new Promise(() => {}),
			);
			expect(remote.pendingRequests()).toEqual([]);
			session.userInteractions.cancelAll();
			await stale;
		} finally {
			begin.resolve();
			session.userInteractions.cancelAll();
			await task;
			await remote.close();
			await session.dispose();
			auth.close();
		}
	},
	10000,
);
