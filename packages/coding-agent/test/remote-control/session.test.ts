import { expect, test } from "bun:test";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";

function fixture(id: string) {
	const prompts: string[] = [];
	let finish = () => {};
	const target = {
		sessionId: id,
		sessionName: id,
		sessionFile: `/tmp/${id}.jsonl`,
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		messages: [],
		isStreaming: false,
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
		prompt: async (text: string) => {
			prompts.push(text);
			await new Promise<void>(resolve => {
				finish = resolve;
			});
		},
		abort: async () => {
			finish();
		},
		steer: async (text: string) => {
			prompts.push(text);
		},
	} as unknown as SessionTarget;
	return { remote: new RemoteSession(target), prompts, finish: () => finish() };
}
test("two sessions preserve identity/model and route prompts to their existing owner exactly once", async () => {
	const a = fixture("a");
	const b = fixture("b");
	expect(a.remote.thread().model).toBe("gpt-6-astra");
	const params = { threadId: "a", input: [{ type: "text", text: "remember alpha" }] };
	const first = await a.remote.call("request-a", "turn/start", params);
	expect(await a.remote.call("request-a", "turn/start", params)).toEqual(first);
	expect(a.prompts).toEqual(["remember alpha"]);
	expect(b.prompts).toEqual([]);
	await expect(b.remote.call("request-b", "turn/start", params)).rejects.toThrow("Thread not found");
	a.finish();
	a.remote.dispose();
	b.remote.dispose();
});
test("rejects unsupported input/model overrides before running anything", async () => {
	const a = fixture("a");
	await expect(
		a.remote.call("r1", "turn/start", { threadId: "a", model: "other", input: [{ type: "text", text: "test" }] }),
	).rejects.toThrow("Unsupported");
	await expect(
		a.remote.call("r2", "turn/start", { threadId: "a", input: [{ type: "image", url: "fixture" }] }),
	).rejects.toThrow("Unsupported");
	expect(a.prompts).toEqual([]);
	a.remote.dispose();
});
test("unsupported methods return explicit protocol errors", async () => {
	const a = fixture("a");
	await expect(a.remote.call("r", "thread/delete", { threadId: "a" })).rejects.toMatchObject({ code: -32601 });
	a.remote.dispose();
});

test("phone can resume metadata and then hydrate paginated turns", async () => {
	const a = fixture("a");
	const resumed = await a.remote.call("resume", "thread/resume", { threadId: "a", excludeTurns: true });
	expect(resumed).toMatchObject({ thread: { id: "a", turns: [] } });
	expect(
		await a.remote.call("page", "thread/turns/list", {
			threadId: "a",
			limit: 20,
			sortDirection: "desc",
			itemsView: "full",
		}),
	).toEqual({ data: [], nextCursor: null, backwardsCursor: null });
	a.remote.dispose();
});

test("phone experimental initial page rejoins live TUI while retaining its configuration", async () => {
	const a = fixture("a");
	const response = await a.remote.call("resume-page", "thread/resume", {
		threadId: "a",
		excludeTurns: true,
		initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "summary" },
		cwd: "/other",
		config: { model: "different", model_reasoning_effort: "low" },
	});
	expect(response).toMatchObject({
		model: "gpt-6-astra",
		cwd: "/tmp",
		initialTurnsPage: { data: [], nextCursor: null, backwardsCursor: null },
		runtimeWorkspaceRoots: ["/tmp"],
		activePermissionProfile: null,
		multiAgentMode: "explicitRequestOnly",
	});
	expect(a.prompts).toEqual([]);
	a.remote.dispose();
});

test("phone reads the actual live queue and absence of a Codex autonomous goal", async () => {
	const a = fixture("a");
	a.remote.target.getQueuedMessages = () => ({ steering: ["steer fixture"], followUp: ["next fixture"] });
	expect(await a.remote.call("goal", "thread/goal/get", { threadId: "a" })).toEqual({ goal: null });
	const queue = await a.remote.call("queue", "thread/queue/list", { threadId: "a", limit: 20 });
	expect(queue).toMatchObject({
		data: [{ input: [{ type: "text", text: "steer fixture" }] }, { input: [{ type: "text", text: "next fixture" }] }],
		nextCursor: null,
	});
	a.remote.target.getQueuedMessages = () => ({ steering: [], followUp: [] });
	expect(await a.remote.call("queue2", "thread/queue/list", { threadId: "a" })).toEqual({
		data: [],
		nextCursor: null,
	});
	a.remote.dispose();
});

test("phone turn metadata preserves the work model and deduplicates client message retries", async () => {
	const a = fixture("a");
	const efforts: unknown[] = [];
	a.remote.target.setThinkingLevel = effort => {
		efforts.push(effort);
	};
	const p = {
		threadId: "a",
		clientUserMessageId: "fixture-user-message",
		model: "gpt-6-astra",
		cwd: "/tmp",
		effort: "high",
		summary: "auto",
		input: [{ type: "text", text: "fixture prompt" }],
	};
	const result = await a.remote.call("phone-1", "turn/start", p);
	expect(await a.remote.call("phone-2", "turn/start", p)).toEqual(result);
	expect(a.prompts).toEqual(["fixture prompt"]);
	expect(efforts).toEqual(["high"]);
	expect(a.remote.target.model?.id).toBe("gpt-6-astra");
	await expect(
		a.remote.call("phone-3", "turn/start", { ...p, input: [{ type: "text", text: "different" }] }),
	).rejects.toThrow("identity");
	a.finish();
	a.remote.dispose();
});
