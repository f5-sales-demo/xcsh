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
