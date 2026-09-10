import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import Ajv from "ajv";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import type { AgentSessionEvent } from "../../src/session/agent-session";
import { SessionManager } from "../../src/session/session-manager";
import itemsSchema from "./fixtures/ThreadItemsListResponse.json";

const remotes: RemoteSession[] = [];
afterEach(() => {
	for (const remote of remotes.splice(0)) remote.dispose();
});
let timestamp = 100000;
const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: ++timestamp });
const assistant = (text: string): AgentMessage =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		timestamp: ++timestamp,
		api: "openai-responses",
		model: "fixture",
		provider: "openai-codex",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	}) as AgentMessage;
function fixture(manager = SessionManager.inMemory("/tmp/history")) {
	const messages: AgentMessage[] = [];
	const listeners = new Set<(event: AgentSessionEvent) => unknown>();
	const target = {
		sessionId: "durable",
		sessionName: "History fixture",
		messages,
		sessionManager: manager,
		isStreaming: false,
		subscribe: (listener: (event: AgentSessionEvent) => unknown) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		prompt: async () => new Promise<void>(() => {}),
		steer: async () => {},
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	remotes.push(remote);
	const emit = (event: Record<string, unknown>) => {
		for (const listener of listeners) listener(event as AgentSessionEvent);
	};
	const message = (value: AgentMessage) => {
		emit({ type: "message_start", message: value });
		messages.push(value);
		// AgentSession emits to subscribers before appendMessage.
		emit({ type: "message_end", message: value });
		manager.appendMessage(value as Parameters<SessionManager["appendMessage"]>[0]);
	};
	const events: { method: string; params: Record<string, unknown> }[] = [];
	remote.subscribe(event => events.push(event));
	return { remote, manager, messages, target, emit, message, events };
}

test("persisted branch history survives compaction and attachment restart", async () => {
	const f = fixture();
	const first = f.manager.appendMessage(user("old remembered context") as never);
	f.manager.appendMessage(assistant("old response") as never);
	const kept = f.manager.appendMessage(user("recent context") as never);
	f.manager.appendMessage(assistant("recent response") as never);
	const before = f.remote.history();
	expect(before).toHaveLength(2);
	f.manager.appendCompaction("model summary", undefined, kept, 10000);
	f.messages.push(user("model summary only"));
	expect(f.remote.history()).toEqual(before);
	expect(f.remote.thread().preview).toBe("old remembered context");
	expect(f.remote.thread().createdAt).toBe(Math.floor(Date.parse(f.manager.getHeader()!.timestamp) / 1000));
	f.remote.dispose();
	const resumed = fixture(f.manager);
	expect(resumed.remote.history()).toEqual(before);
	expect(JSON.stringify(before)).toContain(first);
});

test("branch selection excludes sibling messages and preserves ancestor item identities", () => {
	const f = fixture();
	f.manager.appendMessage(user("root") as never);
	const root = f.manager.appendMessage(assistant("root answer") as never);
	f.manager.appendMessage(user("left") as never);
	f.manager.appendMessage(assistant("left answer") as never);
	const left = f.remote.history();
	f.manager.branch(root);
	f.manager.appendMessage(user("right") as never);
	f.manager.appendMessage(assistant("right answer") as never);
	const right = f.remote.history();
	expect(right).toHaveLength(2);
	expect(right[0]).toEqual(left[0]);
	expect(right[1].id).not.toBe(left[1].id);
	expect(JSON.stringify(right)).not.toContain("left answer");
});

test("one persisted turn owns steering and its stream identities survive reattachment", async () => {
	const f = fixture();
	const result = (await f.remote.call("start", "turn/start", {
		threadId: "durable",
		clientUserMessageId: "phone-one",
		input: [{ type: "text", text: "begin" }],
	})) as { turn: { id: string } };
	f.emit({ type: "agent_start" });
	f.message(user("begin"));
	f.message(assistant("working"));
	await f.remote.call("steer", "turn/steer", {
		threadId: "durable",
		expectedTurnId: result.turn.id,
		clientUserMessageId: "phone-two",
		input: [{ type: "text", text: "adjust" }],
	});
	f.message(user("adjust"));
	f.message(assistant("finished"));
	f.emit({ type: "agent_end" });
	const history = f.remote.history();
	expect(history).toHaveLength(1);
	expect(history[0]).toMatchObject({ id: result.turn.id, status: "completed" });
	expect(history[0].items.filter(item => item.type === "userMessage").map(item => item.clientId)).toEqual([
		"phone-one",
		"phone-two",
	]);
	const completed = f.events.filter(event => event.method === "item/completed").map(event => event.params.item);
	expect(completed).toEqual(history[0].items);
	expect(f.events.filter(event => event.method === "turn/started")).toHaveLength(1);
	expect(f.events.find(event => event.method === "turn/completed")?.params.turn).toEqual(history[0]);
	f.remote.dispose();
	expect(fixture(f.manager).remote.history()).toEqual(history);
});

test("commentary and final content have distinct stable item ids and phases", () => {
	const f = fixture();
	f.emit({ type: "agent_start" });
	f.message(user("work"));
	const value = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	value.content = [
		{ type: "thinking", thinking: "private reasoning" },
		{ type: "text", text: "Working", phase: "commentary" },
		{ type: "text", text: "Done", phase: "final_answer" },
	];
	f.emit({ type: "message_start", message: value });
	for (const contentIndex of [1, 2])
		f.emit({
			type: "message_update",
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex,
				delta: (value.content[contentIndex] as { text: string }).text,
				partial: value,
			},
		});
	f.messages.push(value);
	f.emit({ type: "message_end", message: value });
	f.manager.appendMessage(value);
	f.emit({ type: "agent_end" });
	const items = f.remote.history()[0].items.filter(item => item.type === "agentMessage");
	expect(items.map(item => [item.text, item.phase])).toEqual([
		["Working", "commentary"],
		["Done", "final_answer"],
	]);
	expect(new Set(items.map(item => item.id)).size).toBe(2);
	expect(
		f.events.filter(event => event.method === "item/agentMessage/delta").map(event => event.params.itemId),
	).toEqual(items.map(item => item.id));
	expect(
		f.events
			.filter(
				event => event.method === "item/started" && (event.params.item as { type: string }).type === "agentMessage",
			)
			.map(event => (event.params.item as { text: string }).text),
	).toEqual(["", ""]);
	expect(JSON.stringify(f.remote.history())).not.toContain("private reasoning");
});

test("persisted tool calls expose actual arguments, results and failure status", async () => {
	const f = fixture();
	f.manager.appendMessage(user("read a fixture") as never);
	const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	call.content = [{ type: "toolCall", id: "fixture-call", name: "read", arguments: { path: "fixture.txt" } }];
	call.stopReason = "toolUse";
	f.manager.appendMessage(call);
	f.manager.appendMessage({
		role: "toolResult",
		toolCallId: "fixture-call",
		toolName: "read",
		isError: true,
		content: [{ type: "text", text: "fixture missing" }],
		timestamp: ++timestamp,
	});
	f.manager.appendMessage(assistant("The fixture is missing.") as never);
	const response = (await f.remote.call("items", "thread/items/list", { threadId: "durable" })) as {
		data: { item: Record<string, unknown> }[];
	};
	expect(response.data.map(row => row.item.type)).toEqual(["userMessage", "dynamicToolCall", "agentMessage"]);
	expect(response.data[1].item).toMatchObject({
		tool: "read",
		arguments: { path: "fixture.txt" },
		status: "failed",
		success: false,
		contentItems: [{ type: "inputText", text: "fixture missing" }],
	});
	const ajv = new Ajv({ strict: false, validateFormats: false });
	const validate = ajv.compile(itemsSchema);
	expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
});

test("a failed start persists an empty failed turn without borrowing a previous answer", async () => {
	const f = fixture();
	f.manager.appendMessage(user("old") as never);
	f.manager.appendMessage(assistant("old answer") as never);
	f.target.prompt = async () => {
		throw new Error("private provider detail");
	};
	const result = (await f.remote.call("failure", "turn/start", {
		threadId: "durable",
		input: [{ type: "text", text: "new" }],
	})) as { turn: { id: string } };
	await Bun.sleep(0);
	const last = f.remote.history().at(-1)!;
	expect(last).toMatchObject({ id: result.turn.id, status: "failed", items: [] });
	expect(JSON.stringify(last)).not.toContain("private provider detail");
	expect(fixture(f.manager).remote.history().at(-1)).toEqual(last);
});

test("live tool completion updates history and emits the same canonical item", () => {
	const f = fixture();
	f.emit({ type: "agent_start" });
	f.message(user("read"));
	const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	call.content = [{ type: "toolCall", id: "live-tool", name: "read", arguments: { path: "fixture.txt" } }];
	call.stopReason = "toolUse";
	f.message(call);
	f.message({
		role: "toolResult",
		toolCallId: "live-tool",
		toolName: "read",
		isError: false,
		content: [{ type: "text", text: "contents" }],
		timestamp: ++timestamp,
	});
	const tool = f.remote.history()[0].items.find(item => item.type === "dynamicToolCall");
	expect(tool).toMatchObject({
		status: "completed",
		success: true,
		contentItems: [{ type: "inputText", text: "contents" }],
	});
	expect(f.events.filter(event => event.method === "item/completed").at(-1)?.params.item).toEqual(tool);
});

test("a late prompt promise cannot finish a newer active turn", async () => {
	const f = fixture();
	let finishOld!: () => void;
	f.target.prompt = async () =>
		new Promise<void>(resolve => {
			finishOld = resolve;
		});
	await f.remote.call("old", "turn/start", { threadId: "durable", input: [{ type: "text", text: "old" }] });
	f.message(user("old"));
	f.message(assistant("done"));
	f.emit({ type: "agent_end" });
	f.target.prompt = async () => new Promise<void>(() => {});
	const next = (await f.remote.call("next", "turn/start", {
		threadId: "durable",
		input: [{ type: "text", text: "next" }],
	})) as { turn: { id: string } };
	finishOld();
	await Bun.sleep(0);
	expect(f.remote.history().at(-1)).toMatchObject({ id: next.turn.id, status: "inProgress" });
	expect(f.events.filter(event => event.method === "turn/completed")).toHaveLength(1);
});

test("a crashed incomplete turn becomes interrupted when resumed idle", () => {
	const f = fixture();
	f.emit({ type: "agent_start" });
	f.message(user("unfinished"));
	const activeId = f.remote.history()[0].id;
	f.remote.dispose();
	const resumed = fixture(f.manager);
	expect(resumed.remote.history()[0]).toMatchObject({ id: activeId, status: "interrupted", completedAt: null });
	resumed.emit({ type: "agent_start" });
	resumed.message(user("new work"));
	expect(resumed.remote.history().map(value => value.status)).toEqual(["interrupted", "inProgress"]);
	resumed.message(assistant("new result"));
	resumed.emit({ type: "agent_end" });
	expect(resumed.remote.history().map(value => value.status)).toEqual(["interrupted", "completed"]);
});

test("a successful provider retry clears the earlier failed attempt in the same turn", () => {
	const f = fixture();
	f.emit({ type: "agent_start" });
	f.message(user("recover"));
	const failed = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	failed.stopReason = "error";
	f.message(failed);
	f.message(assistant("Recovered successfully"));
	f.emit({ type: "agent_end" });
	expect(f.remote.history()[0]).toMatchObject({ status: "completed", error: null });
});

test("an abandoned message marker cannot rename an unrelated future message", () => {
	const f = fixture();
	f.manager.appendCustomEntry("remote-history", {
		kind: "message",
		key: '["user",0,null]',
		id: "abandoned-item",
		clientId: "abandoned-client",
	});
	f.manager.appendMessage(user("fresh input") as never);
	expect(f.remote.history()).toHaveLength(1);
	expect(JSON.stringify(f.remote.history())).not.toContain("abandoned");
});

test("provider tool-call id reuse across turns cannot alias canonical items", () => {
	const f = fixture();
	for (const text of ["first", "second"]) {
		f.emit({ type: "agent_start" });
		f.message(user(text));
		const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
		call.content = [{ type: "toolCall", id: "reused-provider-id", name: "read", arguments: { path: text } }];
		call.stopReason = "toolUse";
		f.message(call);
		f.message({
			role: "toolResult",
			toolCallId: "reused-provider-id",
			toolName: "read",
			content: [{ type: "text", text }],
			isError: false,
			timestamp: ++timestamp,
		});
		f.message(assistant(text));
		f.emit({ type: "agent_end" });
	}
	const items = f.remote
		.history()
		.flatMap(turn => turn.items)
		.filter(item => item.type === "dynamicToolCall");
	expect(items).toHaveLength(2);
	expect(items[0].id).not.toBe(items[1].id);
	expect(items.map(item => item.contentItems)).toEqual([
		[{ type: "inputText", text: "first" }],
		[{ type: "inputText", text: "second" }],
	]);
});

test("a remote turn is on disk before dispatch, including starts that fail without an assistant message", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-remote-history-"));
	const manager = SessionManager.create(directory, directory);
	const f = fixture(manager);
	let dispatchedOnDisk = false;
	f.target.prompt = async () => {
		const saved = await SessionManager.open(manager.getSessionFile()!);
		try {
			dispatchedOnDisk = saved
				.getBranch()
				.some(entry => entry.type === "custom" && entry.customType === "remote-history");
		} finally {
			await saved.close();
		}
		throw new Error("fixture provider failure");
	};
	try {
		await f.remote.call("disk", "turn/start", {
			threadId: "durable",
			input: [{ type: "text", text: "fail on first attempt" }],
		});
		for (let i = 0; i < 100 && !f.events.some(event => event.method === "turn/completed"); i++) await Bun.sleep(5);
		expect(dispatchedOnDisk).toBe(true);
		await manager.flush();
		const reopened = await SessionManager.open(manager.getSessionFile()!);
		try {
			expect(fixture(reopened).remote.history()).toEqual(f.remote.history());
			expect(fixture(reopened).remote.history()[0].status).toBe("failed");
		} finally {
			await reopened.close();
		}
	} finally {
		f.remote.dispose();
		await manager.close();
		await rm(directory, { recursive: true, force: true });
	}
});
