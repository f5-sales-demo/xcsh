import { expect, test } from "bun:test";
import { RemoteRouter } from "../../src/remote-control/router";
import type { Notification } from "../../src/remote-control/session";

const question = {
	id: "question-a",
	method: "item/tool/requestUserInput",
	params: { threadId: "thread-a", turnId: "turn-a", itemId: "item-a", questions: [] },
};
async function fixture() {
	const router = new RemoteRouter("/tmp/xcsh", "fixture");
	const calls: unknown[][] = [];
	const sent: { client: string; event: Notification }[] = [];
	router.notify = (client, event) => sent.push({ client, event });
	router.sessions.set("thread-a", {
		thread: { id: "thread-a" },
		requests: [question],
		call: async (...args) => {
			calls.push(args);
			return {};
		},
	});
	for (const client of ["phone", "second", "ordinary", "unsubscribed"])
		await router.handle(client, {
			id: 1,
			method: "initialize",
			params: {
				clientInfo: { name: client, version: "1" },
				capabilities: { experimentalApi: client !== "ordinary" },
			},
		});
	const resume = (client: string) =>
		router.handle(client, { id: 2, method: "thread/resume", params: { threadId: "thread-a" } });
	return { router, calls, sent, resume };
}

test("pending requests replay once per attachment and only to capable subscribers", async () => {
	const { router, sent, resume } = await fixture();
	await resume("ordinary");
	await resume("phone");
	await resume("phone");
	expect(sent).toEqual([{ client: "phone", event: question }]);
	router.close("phone");
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	await resume("phone");
	expect(sent).toHaveLength(2);
	router.dispose();
});

test("responses go only to the delivered request owner and resolved events dismiss every recipient", async () => {
	const { router, calls, sent, resume } = await fixture();
	await resume("phone");
	await resume("second");
	await resume("ordinary");
	calls.length = 0;
	const result = { answers: { "question-a": { answers: ["Beta"] } } };
	for (const client of ["unsubscribed", "ordinary", "unknown"])
		expect(await router.handle(client, { id: question.id, result })).toBeNull();
	expect(calls).toEqual([]);
	expect(await router.handle("phone", { id: question.id, result })).toBeNull();
	expect(calls).toHaveLength(1);
	expect(calls[0].slice(1)).toEqual([
		"session/interaction/respond",
		{ threadId: "thread-a", requestId: question.id, response: result },
	]);
	const resolved = { method: "serverRequest/resolved", params: { threadId: "thread-a", requestId: question.id } };
	router.publish(resolved);
	expect(sent.slice(-2)).toEqual([
		{ client: "phone", event: resolved },
		{ client: "second", event: resolved },
	]);
	expect(router.sessions.get("thread-a")?.requests).toEqual([]);
	await router.handle("second", { id: question.id, result });
	expect(calls).toHaveLength(1);
	router.dispose();
});

test("unsubscribe and protocol errors cannot answer prompts; live requests join the replay snapshot", async () => {
	const { router, calls, sent, resume } = await fixture();
	await resume("phone");
	await router.handle("phone", { id: question.id, error: { code: -1, message: "disconnected" } });
	expect(calls).toHaveLength(1);
	await router.handle("phone", { id: 3, method: "thread/unsubscribe", params: { threadId: "thread-a" } });
	await router.handle("phone", { id: question.id, result: { answers: {} } });
	expect(calls).toHaveLength(1);
	router.publish({ ...question, id: "question-b" });
	expect(sent).toHaveLength(1);
	await resume("second");
	expect(sent.slice(1).map(value => value.event.id)).toEqual(["question-a", "question-b"]);
	router.dispose();
});

test("owner removal resolves displayed questions, closes the thread and discards answer eligibility", async () => {
	const { router, sent, resume, calls } = await fixture();
	await resume("phone");
	await resume("ordinary");
	router.removeSession("thread-a");
	expect(sent.slice(1)).toEqual([
		{
			client: "phone",
			event: { method: "serverRequest/resolved", params: { threadId: "thread-a", requestId: question.id } },
		},
		{ client: "phone", event: { method: "thread/closed", params: { threadId: "thread-a" } } },
		{ client: "ordinary", event: { method: "thread/closed", params: { threadId: "thread-a" } } },
	]);
	expect(router.subscribed("phone", "thread-a")).toBe(false);
	expect(router.sessions.has("thread-a")).toBe(false);
	await router.handle("phone", { id: question.id, result: { answers: {} } });
	expect(calls).toHaveLength(2);
	router.dispose();
});

test("a refreshed registration reconciles lost question events without repeating existing requests", async () => {
	const { router, sent, resume } = await fixture();
	await resume("phone");
	const endpoint = router.sessions.get("thread-a")!;
	router.registerSession("thread-a", endpoint);
	expect(sent).toHaveLength(1);
	const next = { ...question, id: "next-question" };
	router.registerSession("thread-a", { ...endpoint, requests: [next] });
	expect(sent.slice(1).map(value => value.event)).toEqual([
		{ method: "serverRequest/resolved", params: { threadId: "thread-a", requestId: question.id } },
		next,
	]);
	expect(router.sessions.get("thread-a")?.requests).toEqual([next]);
	expect(router.subscribed("phone", "thread-a")).toBe(true);
	router.dispose();
});

test("a delayed attachment cannot replay the previous owner's pending requests", async () => {
	const { router, sent, resume } = await fixture();
	const finish = Promise.withResolvers<void>();
	router.sessions.get("thread-a")!.call = () => finish.promise;
	const attaching = resume("phone");
	router.sessions.set("thread-a", { thread: { id: "thread-a" }, requests: [], call: async () => ({}) });
	finish.resolve();
	await attaching;
	expect(sent).toEqual([]);
	router.dispose();
});

test("request snapshots reject malformed, duplicated, conflicting and oversized entries before changing state", async () => {
	const { router, sent, resume } = await fixture();
	await resume("phone");
	const original = router.sessions.get("thread-a")!;
	const malformed = [
		[{ ...question, id: 5 }],
		[{ ...question, params: { ...question.params, threadId: "other" } }],
		[{ ...question, params: { ...question.params, questions: [{}] } }],
		[question, question],
		[{ ...question, params: { ...question.params, itemId: "changed-item" } }],
		Array.from({ length: 33 }, (_, i) => ({ ...question, id: `question-${i}` })),
		[{ ...question, params: { ...question.params, extra: "x".repeat(1024 * 1024) } }],
	];
	for (const requests of malformed) {
		expect(() => router.registerSession("thread-a", { ...original, requests } as never)).toThrow();
		expect(router.sessions.get("thread-a")?.requests).toEqual([question]);
	}
	expect(sent).toHaveLength(1);
	router.dispose();
});

test("live events obey snapshot limits and immutable request identities", async () => {
	const { router, sent, resume } = await fixture();
	await resume("phone");
	for (let i = 1; i < 32; i++) router.publish({ ...question, id: `question-${i}` });
	expect(sent).toHaveLength(32);
	expect(() => router.publish({ ...question, id: "overflow" })).toThrow();
	expect(() => router.publish({ ...question, params: { ...question.params, itemId: "changed-item" } })).toThrow();
	expect(() => router.publish({ ...question, id: 5 } as never)).toThrow();
	expect(router.sessions.get("thread-a")?.requests).toHaveLength(32);
	router.dispose();
});

test("request identities cannot collide across two live session owners", async () => {
	const { router } = await fixture();
	const other = { ...question, params: { ...question.params, threadId: "thread-b" } };
	expect(() =>
		router.registerSession("thread-b", { thread: { id: "thread-b" }, requests: [other], call: async () => ({}) }),
	).toThrow("identity");
	router.sessions.set("thread-b", { thread: { id: "thread-b" }, requests: [], call: async () => ({}) });
	expect(() => router.publish(other)).toThrow("identity");
	expect(router.sessions.get("thread-b")?.requests).toEqual([]);
	router.dispose();
});
