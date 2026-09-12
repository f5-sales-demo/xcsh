import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import Ajv from "ajv";
import { messageKey } from "../../src/remote-control/history";
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
		if (value.role === "custom")
			manager.appendCustomMessageEntry(
				value.customType,
				value.content,
				value.display,
				value.details,
				"agent",
				value.timestamp,
			);
		else manager.appendMessage(value as Parameters<SessionManager["appendMessage"]>[0]);
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
	const after = f.remote.history();
	expect(after).toHaveLength(2);
	expect(after[0]).toEqual(before[0]);
	expect(after[1].items.slice(0, -1)).toEqual(before[1].items);
	expect(after[1].items.at(-1)).toMatchObject({ type: "contextCompaction" });
	expect(f.remote.thread().preview).toBe("old remembered context");
	expect(f.remote.thread().createdAt).toBe(Math.floor(Date.parse(f.manager.getHeader()!.timestamp) / 1000));
	f.remote.dispose();
	const resumed = fixture(f.manager);
	expect(resumed.remote.history()).toEqual(after);
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

test("accepted client message identities survive a complete adapter restart", async () => {
	const manager = SessionManager.inMemory("/tmp/durable-retry");
	const first = fixture(manager);
	let prompts = 0;
	first.target.prompt = async () => {
		prompts++;
		return new Promise<void>(() => {});
	};
	const params = {
		threadId: "durable",
		clientUserMessageId: "phone-crash-gap",
		input: [{ type: "text", text: "execute this once" }],
	};
	const accepted = (await first.remote.call("first", "turn/start", params)) as { turn: { id: string } };
	expect(prompts).toBe(1);
	first.remote.dispose();

	const resumed = fixture(manager);
	resumed.target.prompt = async () => {
		prompts++;
	};
	const replay = (await resumed.remote.call("retry", "turn/start", params)) as { turn: { id: string } };
	expect(replay.turn.id).toBe(accepted.turn.id);
	expect(prompts).toBe(1);
	expect(resumed.remote.history()).toHaveLength(1);
	const reordered = (await resumed.remote.call("retry-reordered", "turn/start", {
		input: params.input,
		clientUserMessageId: params.clientUserMessageId,
		threadId: params.threadId,
	})) as { turn: { id: string } };
	expect(reordered.turn.id).toBe(accepted.turn.id);
	await expect(
		resumed.remote.call("changed", "turn/start", {
			...params,
			input: [{ type: "text", text: "different work" }],
		}),
	).rejects.toMatchObject({ code: -32600 });
});

test("the accepted request ledger survives closing and reopening the session file", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-remote-request-ledger-"));
	try {
		const manager = SessionManager.create(directory, directory);
		const first = fixture(manager);
		let prompts = 0;
		first.target.prompt = async () => {
			prompts++;
			return new Promise<void>(() => {});
		};
		const params = {
			threadId: first.target.sessionId,
			clientUserMessageId: "phone-file-retry",
			input: [{ type: "text", text: "persist before execution" }],
		};
		const accepted = (await first.remote.call("first", "turn/start", params)) as { turn: { id: string } };
		const file = manager.getSessionFile();
		expect(file).toBeTruthy();
		first.remote.dispose();

		const reopened = await SessionManager.open(file!);
		const resumed = fixture(reopened);
		resumed.target.prompt = async () => {
			prompts++;
		};
		const replay = (await resumed.remote.call("retry", "turn/start", params)) as { turn: { id: string } };
		expect(replay.turn.id).toBe(accepted.turn.id);
		expect(prompts).toBe(1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("completed pre-ledger client messages remain deduplicated after restart", async () => {
	const manager = SessionManager.inMemory("/tmp/durable-legacy-retry");
	const request = user("already executed");
	manager.appendCustomEntry("remote-history", {
		kind: "turnStarted",
		id: "durable-turn-before-ledger",
		startedAtMs: 1000,
	});
	manager.appendCustomEntry("remote-history", {
		kind: "message",
		id: "durable-user-before-ledger",
		key: messageKey(request),
		clientId: "phone-before-ledger",
	});
	manager.appendMessage(request as never);
	manager.appendMessage(assistant("finished before restart") as never);
	manager.appendCustomEntry("remote-history", {
		kind: "turnCompleted",
		id: "durable-turn-before-ledger",
		status: "completed",
		completedAtMs: 2000,
	});
	const resumed = fixture(manager);
	let prompts = 0;
	resumed.target.prompt = async () => {
		prompts++;
	};
	const replay = (await resumed.remote.call("retry", "turn/start", {
		threadId: "durable",
		clientUserMessageId: "phone-before-ledger",
		input: [{ type: "text", text: "already executed" }],
	})) as { turn: { id: string } };
	expect(replay.turn.id).toBe("durable-turn-before-ledger");
	expect(prompts).toBe(0);
});

test("accepted steering identities survive a complete adapter restart", async () => {
	const manager = SessionManager.inMemory("/tmp/durable-steer-retry");
	const first = fixture(manager);
	first.target.prompt = async () => new Promise<void>(() => {});
	let steering = 0;
	first.target.steer = async () => {
		steering++;
	};
	const started = (await first.remote.call("start", "turn/start", {
		threadId: "durable",
		clientUserMessageId: "phone-steer-start",
		input: [{ type: "text", text: "begin once" }],
	})) as { turn: { id: string } };
	const params = {
		threadId: "durable",
		expectedTurnId: started.turn.id,
		clientUserMessageId: "phone-steer-crash-gap",
		input: [{ type: "text", text: "adjust once" }],
	};
	expect(await first.remote.call("steer", "turn/steer", params)).toEqual({ turnId: started.turn.id });
	expect(steering).toBe(1);
	first.remote.dispose();

	const resumed = fixture(manager);
	resumed.target.steer = async () => {
		steering++;
	};
	expect(await resumed.remote.call("steer-retry", "turn/steer", params)).toEqual({ turnId: started.turn.id });
	expect(steering).toBe(1);
	await expect(
		resumed.remote.call("steer-changed", "turn/steer", {
			...params,
			input: [{ type: "text", text: "different adjustment" }],
		}),
	).rejects.toMatchObject({ code: -32600 });
});

test("a failed accepted steering request remains failed after restart", async () => {
	const manager = SessionManager.inMemory("/tmp/durable-steer-failure");
	const first = fixture(manager);
	first.target.prompt = async () => new Promise<void>(() => {});
	const started = (await first.remote.call("start", "turn/start", {
		threadId: "durable",
		input: [{ type: "text", text: "begin" }],
	})) as { turn: { id: string } };
	let steering = 0;
	first.target.steer = async () => {
		steering++;
		throw new Error("fixture steer failure");
	};
	const params = {
		threadId: "durable",
		expectedTurnId: started.turn.id,
		clientUserMessageId: "phone-failed-steer",
		input: [{ type: "text", text: "fail once" }],
	};
	await expect(first.remote.call("steer", "turn/steer", params)).rejects.toThrow("fixture steer failure");
	first.remote.dispose();

	const resumed = fixture(manager);
	resumed.target.steer = async () => {
		steering++;
	};
	await expect(resumed.remote.call("steer-retry", "turn/steer", params)).rejects.toMatchObject({ code: -32000 });
	expect(steering).toBe(1);
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

test("every visible persisted session message has a bounded wire projection", async () => {
	const f = fixture();
	f.emit({ type: "agent_start" });
	f.message(user("show the session transcript"));
	for (const message of [
		{
			role: "developer",
			content: "Visible developer guidance",
			timestamp: ++timestamp,
		},
		{
			role: "bashExecution",
			command: "printf shell",
			output: "shell",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: ++timestamp,
		},
		{
			role: "pythonExecution",
			code: "print('python')",
			output: "python\n",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: ++timestamp,
		},
		{
			role: "fileMention",
			files: [{ path: "src/fixture.ts", content: "private file contents", lineCount: 1 }],
			timestamp: ++timestamp,
		},
		{
			role: "custom",
			customType: "visible-hook",
			content: "Visible extension guidance",
			display: true,
			details: { privateValue: "do-not-project-details" },
			timestamp: ++timestamp,
		},
		{
			role: "custom",
			customType: "hidden-hook",
			content: "hidden private context",
			display: false,
			timestamp: ++timestamp,
		},
		{
			role: "media",
			media: {
				version: 1,
				id: `media_${"a".repeat(24)}`,
				kind: "image",
				original: {
					ref: `blob:sha256:${"b".repeat(64)}`,
					mimeType: "image/png",
					bytes: 1,
				},
				provenance: { sourceType: "path", source: "/tmp/history/fixture.png" },
				playback: { autoplay: false, loop: false, muted: true, fpsCap: 1 },
			},
			timestamp: ++timestamp,
		},
	] as AgentMessage[]) {
		f.message(message);
	}
	f.emit({ type: "agent_end" });

	const history = f.remote.history();
	expect(history).toHaveLength(1);
	expect(history[0].items.map(item => item.type)).toEqual([
		"userMessage",
		"hookPrompt",
		"commandExecution",
		"commandExecution",
		"userMessage",
		"hookPrompt",
		"imageView",
	]);
	expect(history[0].items[1]).toMatchObject({
		fragments: [{ text: "Visible developer guidance" }],
	});
	expect(history[0].items[2]).toMatchObject({
		command: "printf shell",
		source: "userShell",
		status: "completed",
		aggregatedOutput: "shell",
		exitCode: 0,
	});
	expect(history[0].items[3]).toMatchObject({
		command: "print('python')",
		source: "userShell",
		status: "completed",
		aggregatedOutput: "python\n",
		exitCode: 0,
	});
	expect(history[0].items[4]).toMatchObject({
		content: [{ type: "mention", name: "fixture.ts", path: "src/fixture.ts" }],
	});
	expect(history[0].items[5]).toMatchObject({
		fragments: [{ text: "Visible extension guidance", hookRunId: "visible-hook" }],
	});
	expect(history[0].items[6]).toEqual({
		type: "imageView",
		id: expect.any(String),
		path: "/tmp/history/fixture.png",
	});
	const serialized = JSON.stringify(history);
	expect(serialized).not.toContain("hidden private context");
	expect(serialized).not.toContain("do-not-project-details");
	expect(serialized).not.toContain("private file contents");
	const historyIds = history[0].items.map(item => item.id);
	expect(
		f.events.filter(event => event.method === "item/started").map(event => (event.params.item as { id: unknown }).id),
	).toEqual(historyIds);
	expect(
		f.events
			.filter(event => event.method === "item/completed")
			.map(event => (event.params.item as { id: unknown }).id),
	).toEqual(historyIds);

	const response = await f.remote.call("visible-items", "thread/items/list", { threadId: "durable" });
	const validate = new Ajv({ strict: false, validateFormats: false }).compile(itemsSchema);
	expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
});

test("branch summaries and compactions retain visible structural history without private compaction text", () => {
	const f = fixture();
	f.manager.appendMessage(user("root") as never);
	const root = f.manager.appendMessage(assistant("root answer") as never);
	f.manager.branchWithSummary(root, "Visible branch summary");
	f.manager.appendCompaction("private model summary", "Short summary", root, 4096);
	const serialized = JSON.stringify(f.remote.history());
	expect(serialized).toContain("Visible branch summary");
	expect(serialized).toContain("contextCompaction");
	expect(serialized).not.toContain("private model summary");
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

test("accepted steering retains its turn identity when the owner finishes before the reply", async () => {
	const f = fixture();
	f.emit({ type: "agent_start" });
	f.message(user("work"));
	const turnId = f.remote.history()[0].id;
	let accepted = 0;
	f.target.steer = async () => {
		accepted++;
		f.message(assistant("done"));
		f.emit({ type: "agent_end" });
	};
	const params = {
		threadId: "durable",
		expectedTurnId: turnId,
		clientUserMessageId: "steer-race",
		input: [{ type: "text", text: "adjust" }],
	};
	expect(await f.remote.call("steer-race", "turn/steer", params)).toEqual({ turnId });
	expect(await f.remote.call("steer-retry", "turn/steer", params)).toEqual({ turnId });
	expect(accepted).toBe(1);
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

test.each([0, 7])(
	"command items retain their type and actual outcome across live delivery and reload: %s",
	async exitCode => {
		const f = fixture();
		(f.target as any).getToolByName = () => ({ executionKind: "command" });
		f.emit({ type: "agent_start" });
		f.message(user("execute fixture"));
		const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
		call.content = [
			{ type: "toolCall", id: "command-call", name: "bash", arguments: { command: "fixture-command" } },
		];
		call.stopReason = "toolUse";
		f.message(call);
		const start = f.events.find(
			event =>
				event.method === "item/started" && String((event.params.item as any).id).endsWith(":tool:command-call"),
		)?.params.item as Record<string, unknown>;
		expect(start).toMatchObject({
			type: "commandExecution",
			command: "fixture-command",
			cwd: "/tmp/history",
			status: "inProgress",
			exitCode: null,
			durationMs: null,
		});
		const execution = {
			kind: "command",
			command: "resolved-command",
			cwd: "/tmp/history/subdir",
			status: exitCode === 0 ? "completed" : "failed",
			aggregatedOutput: "Actual output\n",
			exitCode,
			durationMs: 12,
			processId: null,
		};
		f.message({
			role: "toolResult",
			toolCallId: "command-call",
			toolName: "bash",
			isError: exitCode !== 0,
			content: [{ type: "text", text: "Display summary" }],
			details: { execution },
			timestamp: ++timestamp,
		});
		f.message(assistant("Done"));
		f.emit({ type: "agent_end" });
		const completed = f.events.find(
			event => event.method === "item/completed" && (event.params.item as any).id === start.id,
		)?.params.item;
		expect(completed).toEqual({
			type: "commandExecution",
			id: start.id,
			pluginId: null,
			scriptPath: null,
			source: "agent",
			commandActions: [],
			command: execution.command,
			cwd: execution.cwd,
			status: execution.status,
			aggregatedOutput: execution.aggregatedOutput,
			exitCode,
			durationMs: 12,
			processId: null,
		});
		const history = f.remote.history();
		expect(history[0].items.find(item => item.id === start.id)).toEqual(completed as Record<string, unknown>);
		const response = await f.remote.call("command-items", "thread/items/list", { threadId: "durable" });
		const validate = new Ajv({ strict: false, validateFormats: false }).compile(itemsSchema);
		expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
		f.remote.dispose();
		expect(fixture(f.manager).remote.history()).toEqual(history);
	},
);

test("an extension using the bash name remains a dynamic tool without command execution provenance", () => {
	const f = fixture();
	(f.target as any).getToolByName = () => ({});
	f.emit({ type: "agent_start" });
	f.message(user("extension call"));
	const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	call.content = [
		{ type: "toolCall", id: "extension-call", name: "bash", arguments: { command: "not a shell command" } },
	];
	f.message(call);
	expect(f.events.filter(event => event.method === "item/started").at(-1)?.params.item).toMatchObject({
		type: "dynamicToolCall",
		tool: "bash",
	});
});

test("malformed command details cannot create invalid wire items", async () => {
	const f = fixture();
	(f.target as any).getToolByName = () => ({ executionKind: "command" });
	f.emit({ type: "agent_start" });
	f.message(user("command"));
	const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	call.content = [{ type: "toolCall", id: "bad-metadata", name: "bash", arguments: { command: "fixture" } }];
	f.message(call);
	f.message({
		role: "toolResult",
		toolCallId: "bad-metadata",
		toolName: "bash",
		isError: true,
		content: [{ type: "text", text: "Command failed" }],
		details: { execution: { kind: "command", cwd: null, exitCode: "7", status: "invented", durationMs: -1 } },
		timestamp: ++timestamp,
	});
	f.emit({ type: "agent_end" });
	const response = await f.remote.call("bad-items", "thread/items/list", { threadId: "durable" });
	const validate = new Ajv({ strict: false, validateFormats: false }).compile(itemsSchema);
	expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
	expect(f.remote.history()[0].items.at(-1)).toMatchObject({
		type: "commandExecution",
		status: "failed",
		exitCode: null,
		durationMs: null,
		aggregatedOutput: "Command failed",
	});
});

test("late background completion updates its original command even when a newer turn reuses the tool call id", () => {
	const f = fixture();
	(f.target as any).getToolByName = () => ({ executionKind: "command" });
	const execution = {
		kind: "command",
		command: "fixture",
		cwd: "/tmp/history",
		status: "inProgress",
		aggregatedOutput: "",
		exitCode: null,
		durationMs: null,
		processId: null,
	};
	const start = (jobId: string) => {
		f.emit({ type: "agent_start" });
		f.message(user(jobId));
		const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
		call.content = [{ type: "toolCall", id: "reused-command", name: "bash", arguments: { command: "fixture" } }];
		f.message(call);
		f.message({
			role: "toolResult",
			toolCallId: "reused-command",
			toolName: "bash",
			isError: false,
			content: [{ type: "text", text: "Running in background" }],
			details: { execution, async: { jobId, state: "running", type: "bash" } },
			timestamp: ++timestamp,
		});
	};
	start("first-job");
	f.emit({ type: "agent_end" });
	const original = f.remote.history()[0];
	const originalItem = original.items.find(item => item.type === "commandExecution")!;
	start("second-job");
	expect(
		f.events.filter(
			event => event.method === "item/completed" && (event.params.item as any).type === "commandExecution",
		),
	).toHaveLength(0);
	const details = {
		execution: { ...execution, aggregatedOutput: "progress" },
		outputDelta: "progress",
		async: { jobId: "first-job" },
	};
	f.emit({ type: "async_job_update", jobId: "first-job", details });
	f.emit({
		type: "tool_execution_update",
		toolCallId: "reused-command",
		toolName: "bash",
		args: {},
		partialResult: { details },
	});
	const deltas = f.events.filter(event => event.method === "item/commandExecution/outputDelta");
	expect(deltas).toHaveLength(1);
	expect(deltas[0].params).toMatchObject({ turnId: original.id, itemId: originalItem.id, delta: "progress" });
	expect(f.remote.history()[0].items.find(item => item.id === originalItem.id)?.aggregatedOutput).toBe("progress");
	const done: AgentMessage = {
		role: "custom",
		customType: "async-result",
		content: "Background result",
		display: true,
		details: {
			jobId: "first-job",
			execution: {
				...execution,
				status: "completed",
				aggregatedOutput: "Final output\n",
				exitCode: 0,
				durationMs: 45,
			},
		},
		timestamp: ++timestamp,
	};
	f.message(done);
	f.message({ ...done, timestamp: ++timestamp });
	const completed = f.events.filter(
		event => event.method === "item/completed" && (event.params.item as any).type === "commandExecution",
	);
	expect(completed).toHaveLength(1);
	expect(completed[0].params).toMatchObject({
		turnId: original.id,
		item: { id: originalItem.id, status: "completed", exitCode: 0, aggregatedOutput: "Final output\n" },
	});
	const history = f.remote.history();
	expect(history[0].items.find(item => item.id === originalItem.id)).toEqual(
		completed[0].params.item as Record<string, unknown>,
	);
	expect(history[1].items.find(item => item.type === "commandExecution")?.status).toBe("inProgress");
	f.emit({ type: "agent_end" });
	const settled = f.remote.history();
	f.remote.dispose();
	expect(fixture(f.manager).remote.history()).toEqual(settled);
});

test("command output deltas contain incremental output and update the active command preview", () => {
	const f = fixture();
	(f.target as any).getToolByName = () => ({ executionKind: "command" });
	f.emit({ type: "agent_start" });
	f.message(user("stream a command"));
	const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	call.content = [{ type: "toolCall", id: "stream-command", name: "bash", arguments: { command: "fixture" } }];
	f.message(call);
	const item = f.remote.history()[0].items.at(-1)!;
	const execution = {
		kind: "command",
		command: "fixture",
		cwd: "/tmp/history",
		status: "inProgress",
		exitCode: null,
		durationMs: null,
		processId: null,
	};
	for (const [outputDelta, aggregatedOutput] of [
		["first\n", "first\n"],
		["second\n", "first\nsecond\n"],
	])
		f.emit({
			type: "tool_execution_update",
			toolCallId: "stream-command",
			toolName: "bash",
			args: {},
			partialResult: {
				content: [{ type: "text", text: aggregatedOutput }],
				details: { execution: { ...execution, aggregatedOutput }, outputDelta },
			},
		});
	const deltas = f.events.filter(event => event.method === "item/commandExecution/outputDelta");
	expect(deltas.map(event => event.params)).toEqual(
		["first\n", "second\n"].map(delta => ({
			threadId: "durable",
			turnId: f.remote.history()[0].id,
			itemId: item.id,
			delta,
		})),
	);
	expect(f.remote.history()[0].items.at(-1)).toMatchObject({
		id: item.id,
		aggregatedOutput: "first\nsecond\n",
		status: "inProgress",
	});
	expect(
		f.events.filter(event => event.method === "item/started" && (event.params.item as any).id === item.id),
	).toHaveLength(1);
});

test.each(["completed", "failed", "declined"])(
	"file items preserve execution facts through events and storage: %s",
	status => {
		const f = fixture();
		(f.target as any).getToolByName = () => ({ executionKind: "fileChange" });
		f.emit({ type: "agent_start" });
		f.message(user("change fixture"));
		const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
		call.content = [{ type: "toolCall", id: "file-call", name: "native-file-tool", arguments: { path: "a.txt" } }];
		call.stopReason = "toolUse";
		f.message(call);
		const starts = f.events.filter(
			event => event.method === "item/started" && (event.params.item as any).type === "fileChange",
		);
		expect(starts).toHaveLength(1);
		const initial = starts[0].params.item as Record<string, unknown>;
		expect(initial).toEqual({ type: "fileChange", id: expect.any(String), changes: [], status: "inProgress" });
		expect(
			f.events.filter(event => event.method === "item/completed" && (event.params.item as any).id === initial.id),
		).toHaveLength(0);
		const changes = [{ path: "/tmp/history/a.txt", type: "add", content: "actual contents\n" }];
		f.message({
			role: "toolResult",
			toolCallId: "file-call",
			toolName: "native-file-tool",
			content: [{ type: "text", text: "Display summary" }],
			details: { execution: { kind: "fileChange", status, changes } },
			isError: status !== "completed",
			timestamp: ++timestamp,
		});
		f.emit({ type: "agent_end", messages: f.messages });
		const expected = {
			...initial,
			status,
			changes: [{ path: "/tmp/history/a.txt", kind: { type: "add" }, diff: "actual contents\n" }],
		};
		const completions = f.events.filter(
			event => event.method === "item/completed" && (event.params.item as any).id === initial.id,
		);
		expect(completions).toHaveLength(1);
		expect(completions[0].params.item).toEqual(expected);
		expect(f.remote.history()[0].items.find(item => item.id === initial.id)).toEqual(expected);
		f.remote.dispose();
		expect(
			fixture(f.manager)
				.remote.history()[0]
				.items.find(item => item.id === initial.id),
		).toEqual(expected);
	},
);

test("file progress updates the existing item and ignores malformed and late patches", async () => {
	const f = fixture();
	(f.target as any).getToolByName = () => ({ executionKind: "fileChange" });
	f.emit({ type: "agent_start" });
	f.message(user("update fixture"));
	const call = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	call.content = [{ type: "toolCall", id: "progress-file", name: "native-file-tool", arguments: {} }];
	call.stopReason = "toolUse";
	f.message(call);
	const execution = {
		kind: "fileChange",
		status: "inProgress",
		changes: [{ path: "/tmp/history/a", type: "update", unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n", movePath: null }],
	};
	const progress = (value: unknown) =>
		f.emit({
			type: "tool_execution_update",
			toolCallId: "progress-file",
			toolName: "native-file-tool",
			args: {},
			partialResult: { content: [], details: { execution: value } },
		});
	progress({ ...execution, changes: [{ path: "/tmp/history/a", type: "update", unifiedDiff: 42 }] });
	expect(f.events.filter(event => event.method === "item/fileChange/patchUpdated")).toHaveLength(0);
	progress(execution);
	const patch = f.events.filter(event => event.method === "item/fileChange/patchUpdated");
	expect(patch).toHaveLength(1);
	const current = f.remote.history()[0].items.find(item => item.type === "fileChange")!;
	expect(patch[0].params).toEqual({
		threadId: "durable",
		turnId: f.remote.history()[0].id,
		itemId: current.id,
		changes: current.changes,
	});
	expect(current).toMatchObject({
		status: "inProgress",
		changes: [
			{ path: "/tmp/history/a", kind: { type: "update", move_path: null }, diff: execution.changes[0].unifiedDiff },
		],
	});
	f.message({
		role: "toolResult",
		toolCallId: "progress-file",
		toolName: "native-file-tool",
		content: [],
		details: { execution: { ...execution, status: "completed" } },
		isError: false,
		timestamp: ++timestamp,
	});
	progress({ ...execution, changes: [] });
	expect(f.events.filter(event => event.method === "item/fileChange/patchUpdated")).toHaveLength(1);
	f.emit({ type: "agent_end", messages: f.messages });
	expect(f.remote.history()[0].items.find(item => item.id === current.id)).toMatchObject({
		status: "completed",
		changes: current.changes,
	});
	const response = await f.remote.call("phone", "thread/items/list", { threadId: "durable" });
	const validate = new Ajv({ strict: false, validateFormats: false }).compile(itemsSchema);
	expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
	expect(
		f.events.filter(event => event.method === "item/started" && (event.params.item as any).type === "fileChange"),
	).toHaveLength(1);
});

test("attachment during an active assistant stream hydrates one live item and keeps its durable identity", () => {
	const manager = SessionManager.inMemory("/tmp/active-attachment");
	manager.appendCustomEntry("remote-history", {
		kind: "turnStarted",
		id: "durable-active-turn",
		startedAtMs: 1000,
	});
	const partial = assistant("") as Extract<AgentMessage, { role: "assistant" }>;
	partial.content = [
		{ type: "text", text: "Working", phase: "commentary" },
		{ type: "toolCall", id: "active-command", name: "bash", arguments: { command: "printf active" } },
	];
	const listeners = new Set<(event: AgentSessionEvent) => unknown>();
	const messages: AgentMessage[] = [];
	const target = {
		sessionId: "durable",
		sessionName: "Active fixture",
		messages,
		sessionManager: manager,
		isStreaming: true,
		activeStreamMessage: partial,
		getToolByName: () => ({ executionKind: "command" }),
		getActiveToolExecutions: () => [
			{
				toolCallId: "active-command",
				kind: "command" as const,
				cwd: "/tmp/active-attachment",
				execution: {
					kind: "command",
					command: "printf active",
					cwd: "/tmp/active-attachment",
					status: "inProgress",
					aggregatedOutput: "act",
					processId: "fixture-process",
					exitCode: null,
					durationMs: null,
				},
			},
		],
		subscribe: (listener: (event: AgentSessionEvent) => unknown) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		prompt: async () => {},
		steer: async () => {},
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	remotes.push(remote);
	const initial = remote.history()[0];
	expect(initial).toMatchObject({ id: "durable-active-turn", status: "inProgress" });
	expect(initial.items.map(item => item.type)).toEqual(["agentMessage", "commandExecution"]);
	expect(initial.items[0]).toMatchObject({ text: "Working", phase: "commentary" });
	expect(initial.items[1]).toMatchObject({ aggregatedOutput: "act", processId: "fixture-process" });

	for (const listener of listeners) listener({ type: "message_end", message: partial });
	manager.appendMessage(partial);
	const after = remote.history()[0];
	expect(after.items.map(item => item.id)).toEqual(initial.items.map(item => item.id));
	expect(after.items.filter(item => item.type === "agentMessage")).toHaveLength(1);
});
