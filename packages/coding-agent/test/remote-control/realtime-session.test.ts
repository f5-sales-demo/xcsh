import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type Message } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { convertToLlm } from "../../src/session/messages";
import { SessionManager } from "../../src/session/session-manager";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
function modeText(messages: Message[]) {
	return messages
		.filter(message => message.role === "developer")
		.flatMap(message =>
			typeof message.content === "string"
				? [message.content]
				: message.content.filter(part => part.type === "text").map(part => part.text),
		)
		.filter(text => text.includes("<realtime_conversation>"));
}
async function fixture(manager?: SessionManager, prune = false) {
	const dir = await mkdtemp("/tmp/xcsh-realtime-session-");
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const auth = await AuthStorage.create(":memory:");
	cleanup.push(() => auth.close());
	auth.setRuntimeApiKey("openai", "fixture-key");
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const settings = Settings.isolated({ "compaction.enabled": false, "context.loadingMode": "progressive" });
	settings.setModelRole("default", `${model.provider}/${model.id}`);
	manager ??= SessionManager.create(dir, dir);
	const agent = new Agent({
		initialState: { model, systemPrompt: "Fixture", tools: [], messages: manager.buildSessionContext().messages },
		convertToLlm,
		transformContext: prune
			? async messages =>
					messages.filter(message => !("customType" in message && message.customType.startsWith("remote-voice-")))
			: undefined,
	});
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settings,
		modelRegistry: new ModelRegistry(auth),
	});
	cleanup.push(() => session.dispose());
	const requests: Message[][] = [];
	let useTool = false,
		executions = 0;
	let onTool = async () => {};
	agent.setTools([
		{
			name: "fixture",
			label: "Fixture",
			description: "Fixture",
			parameters: Type.Object({}),
			execute: async () => {
				executions++;
				await onTool();
				return { content: [{ type: "text", text: "done" }], details: {} };
			},
		},
	]);
	agent.streamFn = (_model, context) => {
		requests.push([...context.messages]);
		const tool = useTool;
		useTool = false;
		const out = new AssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			api: model.api,
			model: model.id,
			provider: model.provider,
			timestamp: Date.now(),
			content: tool
				? [{ type: "toolCall", id: `fixture-${requests.length}`, name: "fixture", arguments: {} }]
				: [{ type: "text", text: "done" }],
			stopReason: tool ? "toolUse" : "stop",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		queueMicrotask(() => out.push({ type: "done", reason: tool ? "toolUse" : "stop", message }));
		return out;
	};
	return {
		session,
		requests,
		manager,
		executions: () => executions,
		tool: (fn: () => Promise<void>) => {
			onTool = fn;
			useTool = true;
		},
	};
}

test("unobserved voice produces no queued work or mode history", async () => {
	const f = await fixture();
	f.session.setRealtimeMode(true, {});
	f.session.setRealtimeMode(false, {});
	expect(f.session.messages).toEqual([]);
	await f.session.prompt("fixture typed prompt");
	expect(modeText(f.requests[0])).toEqual([]);
	expect(f.requests).toHaveLength(1);
});
test("an active session persists its default instruction only once", async () => {
	const f = await fixture();
	f.session.setRealtimeMode(true, {});
	await f.session.prompt("first fixture");
	await f.session.prompt("second fixture");
	for (const request of f.requests) expect(modeText(request)).toHaveLength(1);
	expect(modeText(f.requests[0])[0]).toContain("Realtime conversation started.");
	expect(
		f.manager
			.getBranch()
			.filter(entry => entry.type === "custom_message" && entry.customType === "remote-voice-start"),
	).toHaveLength(1);
});
test("ending voice during a tool preserves work and the turn snapshot", async () => {
	const f = await fixture();
	f.session.setRealtimeMode(true, { start: "voice start", end: "voice end" });
	f.tool(async () => {
		f.session.setRealtimeMode(false, { start: "voice start", end: "voice end" });
	});
	await f.session.prompt("fixture tool task");
	expect(f.executions()).toBe(1);
	expect(f.requests).toHaveLength(2);
	for (const request of f.requests)
		expect(modeText(request)).toEqual(["<realtime_conversation>\nvoice start\n</realtime_conversation>"]);
	await f.session.prompt("typed follow-up");
	expect(modeText(f.requests[2]).at(-1)).toContain("\nvoice end\n");
});
test("starting voice during typed work waits until a new turn", async () => {
	const f = await fixture();
	f.tool(async () => {
		f.session.setRealtimeMode(true, {});
	});
	await f.session.prompt("fixture typed task");
	for (const request of f.requests) expect(modeText(request)).toEqual([]);
	await f.session.prompt("fixture voice task");
	expect(modeText(f.requests[2])[0]).toContain("Realtime conversation started.");
});
test("context pruning restores active instructions through the persistence owner", async () => {
	const f = await fixture(undefined, true);
	f.session.setRealtimeMode(true, {});
	f.tool(async () => {});
	await f.session.prompt("fixture tool task");
	for (const request of f.requests) expect(modeText(request)).toHaveLength(1);
	expect(
		f.manager
			.getBranch()
			.filter(entry => entry.type === "custom_message" && entry.customType === "remote-voice-start"),
	).toHaveLength(2);
});
test("cold disk resume ends retained voice without inheriting an active call", async () => {
	const f = await fixture();
	f.session.setRealtimeMode(true, { end: "old custom end" });
	await f.session.prompt("fixture voice task");
	const file = f.session.sessionFile!;
	await f.session.dispose();
	const resumed = await fixture(await SessionManager.open(file));
	await resumed.session.prompt("fixture typed task");
	expect(modeText(resumed.requests[0]).at(-1)).toContain("Realtime conversation ended.");
	expect(modeText(resumed.requests[0]).at(-1)).not.toContain("old custom end");
});
test("new session identity does not inherit the old active mode", async () => {
	const f = await fixture();
	f.session.setRealtimeMode(true, {});
	await f.session.prompt("fixture voice task");
	await f.session.newSession();
	await f.session.prompt("fixture typed task");
	expect(modeText(f.requests.at(-1)!)).toEqual([]);
});
