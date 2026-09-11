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

test("a host restart preserves ongoing owner work, retry identity, history and subscriber events", async () => {
	const dir = await mkdtemp("/tmp/xcsh-host-restart-");
	const path = `${dir}/host.sock`;
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const auth = await AuthStorage.create(":memory:");
	auth.setRuntimeApiKey(model.provider, "fixture-key");
	const entered = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
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
					execute: async () => {
						executions++;
						entered.resolve();
						await finish.promise;
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
	let observer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	const unrelatedEvents: unknown[] = [];
	const events: any[] = [];
	const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
		phone.call("protocol", { request: { id, method, params } }) as Promise<any>;
	const initialize = () => request(1, "initialize", { clientInfo: { name: "fixture", version: "1" } });
	const registered = async () => {
		const deadline = Date.now() + 1000;
		while (!host.router.sessions.has(session.sessionId) && Date.now() < deadline) await Bun.sleep(5);
		expect(host.router.sessions.has(session.sessionId)).toBe(true);
	};
	try {
		await registered();
		phone.handle = async () => ({});
		await initialize();
		const params = {
			threadId: session.sessionId,
			clientUserMessageId: "fixture-retry",
			input: [{ type: "text", text: "Use fixture" }],
		};
		const accepted = await request(2, "turn/start", params);
		expect(accepted.error).toBeUndefined();
		await entered.promise;
		await session.setSessionName("fixture renamed", "user");
		await host.close();
		expect(agent.state.isStreaming).toBe(true);
		expect(executions).toBe(1);
		host = await startLocalHost(path, "fixture");
		phone = await connectPeer(path);
		observer = await connectPeer(path);
		observer.handle = async (_method, params) => {
			unrelatedEvents.push(params.event);
			return {};
		};
		await observer.call("protocol", {
			request: {
				id: 1,
				method: "initialize",
				params: {
					clientInfo: { name: "observer", version: "1" },
					capabilities: { optOutNotificationMethods: ["thread/started"] },
				},
			},
		});
		phone.handle = async (_method, params) => {
			events.push(params.event);
			return {};
		};
		await registered();
		await initialize();
		const retry = await request(2, "turn/start", params);
		expect(host.router.sessions.get(session.sessionId)?.thread.name).toBe("fixture renamed");
		expect(retry.result.turn.id).toBe(accepted.result.turn.id);
		expect(executions).toBe(1);
		finish.resolve();
		await agent.waitForIdle();
		const deadline = Date.now() + 1000;
		while (!events.some(event => event?.method === "turn/completed") && Date.now() < deadline) await Bun.sleep(5);
		const history = await request(3, "thread/read", { threadId: session.sessionId, includeTurns: true });
		expect(history.result.thread.turns).toHaveLength(1);
		expect(history.result.thread.turns[0]).toMatchObject({ id: accepted.result.turn.id, status: "completed" });
		expect(history.result.thread.turns[0].items.map((item: any) => item.type)).toEqual([
			"userMessage",
			"dynamicToolCall",
			"agentMessage",
		]);
		expect(executions).toBe(1);
		expect(events.some(event => event?.method === "turn/completed")).toBe(true);
		expect(unrelatedEvents).toEqual([]);
		await request(2, "turn/start", params);
		expect(executions).toBe(1);
	} finally {
		finish.resolve();
		await agent.waitForIdle();
		await stop();
		phone.close();
		observer?.close();
		await host.close();
		await session.dispose();
		auth.close();
		await rm(dir, { recursive: true, force: true });
	}
});
