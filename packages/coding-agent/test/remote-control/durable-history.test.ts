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
		if (value.role === "custom")
			manager.appendCustomMessageEntry(value.customType, value.content, value.display, value.details);
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
