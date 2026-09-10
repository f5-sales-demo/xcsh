import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { startSessionBridge } from "../../src/remote-control/bridge";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test("a real owner question survives host restart and the phone answers its original tool once", async () => {
	const dir = await mkdtemp("/tmp/xcsh-host-restart-");
	const path = `${dir}/host.sock`;
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const auth = await AuthStorage.create(":memory:");
	auth.setRuntimeApiKey(model.provider, "fixture-key");
	const entered = Promise.withResolvers<void>();
	let answer: string | undefined;
	let executions = 0;
	let iteration = 0;
	const agent = new Agent({
		getApiKey: () => "fixture-key",
		initialState: {
			model,
			messages: [],
			tools: [
				{
					name: "fixture",
					label: "Fixture",
					description: "Fixture",
					parameters: Type.Object({}),
					execute: async (toolCallId, _params, signal) => {
						executions++;
						const pending = session.userInteractions.request(
							{ kind: "select", title: "Choose fixture", options: ["Allow", "Deny"], toolCallId },
							() => new Promise(() => {}),
							signal,
						);
						entered.resolve();
						answer = await pending;
						return { content: [{ type: "text", text: "fixture result" }], details: {} };
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
					? [{ type: "toolCall", id: "fixture-call", name: "fixture", arguments: {} }]
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
	const manager = SessionManager.create(dir, dir);
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
	});
	let host = await startLocalHost(path, "fixture");
	const stop = startSessionBridge(session, path, 10);
	let phone = await connectPeer(path);
	const events: any[] = [];
	const observe = () => {
		phone.handle = async (_method, params) => {
			events.push(params.event);
			return {};
		};
	};
	const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
		phone.call("protocol", { request: { id, method, params } }) as Promise<any>;
	const initialize = () =>
		request(1, "initialize", {
			clientInfo: { name: "fixture", version: "1" },
			capabilities: { experimentalApi: true },
		});
	const waitFor = async (predicate: () => boolean) => {
		const deadline = Date.now() + 2000;
		while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
		expect(predicate()).toBe(true);
	};
	try {
		observe();
		await waitFor(() => host.router.sessions.has(session.sessionId));
		await initialize();
		const accepted = await request(2, "turn/start", {
			threadId: session.sessionId,
			input: [{ type: "text", text: "Ask fixture permission" }],
		});
		expect(accepted.error).toBeUndefined();
		await entered.promise;
		await waitFor(() => events.some(event => event.method === "item/tool/requestUserInput"));
		const original = events.find(event => event.method === "item/tool/requestUserInput");
		expect(original.params.turnId).toBe(accepted.result.turn.id);
		expect(original.params.itemId).toContain(":tool:fixture-call");
		expect(session.userInteractions.pending()).toHaveLength(1);
		await host.close();
		expect(agent.state.isStreaming).toBe(true);
		expect(session.userInteractions.pending()[0].id).toBe(original.id);
		host = await startLocalHost(path, "fixture");
		phone = await connectPeer(path);
		events.length = 0;
		observe();
		await waitFor(() => host.router.sessions.has(session.sessionId));
		await initialize();
		await request(3, "thread/resume", { threadId: session.sessionId });
		await waitFor(() => events.some(event => event.method === "item/tool/requestUserInput"));
		expect(events.find(event => event.method === "item/tool/requestUserInput")).toEqual(original);
		const response = { id: original.id, result: { answers: { [original.id]: { answers: ["Deny"] } } } };
		expect(await phone.call("protocol", { request: response })).toBeNull();
		await agent.waitForIdle();
		await waitFor(() => events.some(event => event.method === "serverRequest/resolved"));
		expect(answer).toBe("Deny");
		expect(executions).toBe(1);
		expect(session.userInteractions.pending()).toEqual([]);
		await phone.call("protocol", { request: response });
		expect(executions).toBe(1);
		const history = await request(4, "thread/read", { threadId: session.sessionId, includeTurns: true });
		expect(history.result.thread.turns[0].items.some((item: any) => item.id === original.params.itemId)).toBe(true);
	} finally {
		session.userInteractions.cancelAll();
		await agent.waitForIdle();
		await stop();
		phone.close();
		await host.close();
		await session.dispose();
		auth.close();
		await rm(dir, { recursive: true, force: true });
	}
});
