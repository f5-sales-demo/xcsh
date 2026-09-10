import { expect, test } from "bun:test";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { RemoteSession } from "../../src/remote-control/session";
import { getSessionVoiceHistory } from "../../src/remote-control/session-voice-history";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test.each([
	{ anotherCall: false, blocked: false },
	{ anotherCall: true, blocked: false },
	{ anotherCall: false, blocked: true },
])(
	"backing results follow pinned voice association: %j",
	async ({ anotherCall, blocked }) => {
		const releasePersistence = Promise.withResolvers<void>();
		let terminalTask: Promise<void> | undefined;
		const entered = Promise.withResolvers<void>(),
			release = Promise.withResolvers<void>();
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
						description: "Fixture tool",
						parameters: Type.Object({}),
						execute: async () => {
							executions++;
							entered.resolve();
							await release.promise;
							return { content: [{ type: "text", text: "tool result" }], details: {} };
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
						? [
								{ type: "text", text: "::codex-realtime-inline{}\nWorking", phase: "commentary" },
								{ type: "toolCall", id: "owner-call", name: "fixture", arguments: {} },
							]
						: [{ type: "text", text: "::codex-realtime-inline{}\nOwner finished", phase: "final_answer" }],
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
		const manager = SessionManager.inMemory();
		const session = new AgentSession({
			agent,
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
		});
		const remote = new RemoteSession(session);
		const owner = getSessionVoiceHistory(session);
		const events: { method: string; params: Record<string, unknown> }[] = [];
		const completed = Promise.withResolvers<void>();
		remote.subscribe(event => {
			events.push(event);
			if (event.method === "turn/completed") completed.resolve();
		});
		try {
			await owner.history.start("voice-1");
			if (blocked) {
				const flush = manager.flush.bind(manager);
				manager.flush = async () => {
					await releasePersistence.promise;
					await flush();
				};
				void owner.history.transcript("assistant", "Earlier", true);
				void owner.history.transcript("user", "Pending speech", false);
			} else await owner.history.transcript("user", "Pending speech", false);
			if (blocked) terminalTask = session.prompt("Use fixture");
			else
				await remote.call("owner", "turn/start", {
					threadId: session.sessionId,
					input: [{ type: "text", text: "Use fixture" }],
				});
			if (blocked) {
				await Bun.sleep(20);
				expect(executions).toBe(0);
				releasePersistence.resolve();
			}
			await entered.promise;
			releasePersistence.resolve();
			await owner.history.drain();
			const sealed = events.findIndex(
				event =>
					event.method === "thread/realtime/item/completed" &&
					(event.params.item as any).type === "transcriptSegment",
			);
			const user = events.findIndex(
				event => event.method === "item/started" && (event.params.item as any).type === "userMessage",
			);
			expect(sealed).toBeGreaterThan(-1);
			expect(sealed).toBeLessThan(user);
			const branch = manager.getBranch();
			const persistedSpeech = branch.findIndex(
				entry =>
					entry.type === "custom" &&
					entry.customType === "remote-realtime" &&
					(entry.data as any)?.item?.type === "transcriptSegment" &&
					(entry.data as any)?.item?.text === "Pending speech",
			);
			const persistedUser = branch.findIndex(entry => entry.type === "message" && entry.message.role === "user");
			expect(persistedSpeech).toBeLessThan(persistedUser);
			await owner.history.close(false);
			if (anotherCall) await owner.history.start("voice-2");
			release.resolve();
			await completed.promise;
			await terminalTask;
			await owner.history.drain();
			expect(executions).toBe(1);
			const promotions = events
				.filter(
					event =>
						event.method === "thread/realtime/item/completed" &&
						(event.params.item as any).type === "bemItemPromoted",
				)
				.map(event => event.params.item);
			expect(promotions).toHaveLength(anotherCall ? 3 : 2);
			expect(promotions.map(item => (item as any).presentation.type)).toEqual(
				anotherCall ? ["inlineMarkdown", "wholeItem", "inlineMarkdown"] : ["inlineMarkdown", "inlineMarkdown"],
			);
			expect(promotions.map(item => (item as any).realtimeSessionId)).toEqual(
				anotherCall ? ["voice-1", "voice-2", "voice-2"] : ["voice-1", "voice-1"],
			);
			const firstOwner = owner;
			await remote.close();
			const reattached = new RemoteSession(session);
			try {
				expect(getSessionVoiceHistory(session)).toBe(firstOwner);
			} finally {
				await reattached.close();
			}
		} finally {
			releasePersistence.resolve();
			release.resolve();
			await terminalTask;
			await remote.close();
			await session.dispose();
			auth.close();
		}
	},
	10000,
);

test("queued backing notifications retain their captured payload", async () => {
	const manager = SessionManager.inMemory();
	const target = {
		sessionId: "snapshot",
		sessionManager: manager,
	} as unknown as import("../../src/remote-control/session").SessionTarget;
	const owner = getSessionVoiceHistory(target);
	await owner.history.start("voice");
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const originalFlush = manager.flush.bind(manager);
	manager.flush = async () => {
		entered.resolve();
		await release.promise;
		await originalFlush();
	};
	const transcript = owner.history.transcript("user", "Pending", true);
	await entered.promise;
	const params = { turnId: "turn", item: { id: "item", type: "agentMessage", text: "Captured" } };
	let forwarded: Record<string, unknown> | undefined;
	const pending = owner.dispatch("item/started", params, (value?: Record<string, unknown>) => {
		forwarded = value;
	});
	params.item.text = "Changed later";
	release.resolve();
	await transcript;
	await pending;
	expect(forwarded).toMatchObject({ item: { text: "Captured" } });
	await manager.close();
});
