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
