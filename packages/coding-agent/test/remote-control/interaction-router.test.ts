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

test("request identities cannot collide across owners and hidden-owner events are dropped", async () => {
	const { router } = await fixture();
	const other = { ...question, params: { ...question.params, threadId: "thread-b" } };
	expect(() =>
		router.registerSession("thread-b", { thread: { id: "thread-b" }, requests: [other], call: async () => ({}) }),
	).toThrow("identity");
	router.sessions.set("thread-b", { thread: { id: "thread-b" }, requests: [], call: async () => ({}) });
	expect(() => router.publish(other)).not.toThrow();
	expect(router.sessions.get("thread-b")?.requests).toEqual([]);
	router.dispose();
});

test("a secondary terminal publishes and subscribes before its grouped asynchronous item", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "fixture", undefined, "primary");
	const sent: { client: string; event: Notification }[] = [];
	router.notify = (client, event) => sent.push({ client, event });
	const endpoint = (id: string) => ({
		thread: { id, name: id },
		call: async () => ({ thread: { id }, turns: [] }),
	});
	router.registerSession("primary", endpoint("primary"));
	router.registerSession("secondary", endpoint("secondary"));
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	const before = (await router.handle("phone", { id: 2, method: "thread/list", params: {} })) as any;
	expect(before.result.data.map((thread: any) => thread.id)).toEqual(["primary"]);
	const item = {
		id: "ask",
		type: "agentMessage",
		text: "Phone structured UAT\n- Alpha\n- Beta",
		phase: "final_answer",
		delivery: "async",
		questions: [{ title: "Phone structured UAT", options: ["Alpha", "Beta"] }],
	};
	router.publish({ method: "item/completed", params: { threadId: "secondary", turnId: "turn", item } });
	expect(router.subscribed("phone", "secondary")).toBe(true);
	expect(sent.map(value => value.event.method)).toEqual(["thread/started", "item/started", "item/completed"]);
	expect((sent[1].event.params.item as any).questions).toEqual(item.questions);
	const after = (await router.handle("phone", { id: 3, method: "thread/list", params: {} })) as any;
	expect(new Set(after.result.data.map((thread: any) => thread.id))).toEqual(new Set(["primary", "secondary"]));
	router.dispose();
});

test("a structured async item keeps its required lifecycle when the phone opts out of ordinary item starts", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "fixture", undefined, "primary");
	const sent: Notification[] = [];
	router.notify = (_client, event) => sent.push(event);
	router.registerSession("primary", { thread: { id: "primary" }, call: async () => ({}) });
	router.registerSession("secondary", {
		thread: { id: "secondary", name: null },
		asyncInteractions: [
			{
				requestId: "request",
				questionId: "ask:0",
				title: "Phone structured UAT",
				options: ["Alpha", "Beta"],
				identity: { sessionId: "secondary", threadId: "secondary", turnId: "turn", itemId: "ask", generation: 1 },
			},
		],
		call: async () => ({}),
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: {
			clientInfo: { name: "phone", version: "1" },
			capabilities: { experimentalApi: true, optOutNotificationMethods: ["item/started"] },
		},
	});
	await Bun.sleep(5);
	const item = {
		id: "ask",
		type: "agentMessage",
		text: "Phone structured UAT\n- Alpha\n- Beta",
		phase: "final_answer",
		delivery: "async",
		questions: [{ title: "Phone structured UAT", options: ["Alpha", "Beta"] }],
	};
	router.publish({
		method: "item/started",
		params: { threadId: "secondary", turnId: "turn", item: { ...item, text: "" } },
	});
	router.publish({ method: "item/completed", params: { threadId: "secondary", turnId: "turn", item } });
	expect(sent.map(event => event.method)).toEqual([
		"thread/started",
		"item/tool/requestUserInput",
		"item/started",
		"item/completed",
	]);
	expect(sent[1]).toMatchObject({
		method: "item/tool/requestUserInput",
		params: {
			isBlocking: false,
			questions: [
				{
					header: "Phone structured UAT",
					question: "Phone structured UAT",
					options: [{ label: "Alpha" }, { label: "Beta" }],
				},
			],
		},
	});
	expect((sent[0].params.thread as Record<string, unknown>).name).toBe("Phone structured UAT");
	expect(
		((await router.handle("phone", { id: 2, method: "thread/list", params: {} })) as any).result.data.find(
			(thread: any) => thread.id === "secondary",
		).name,
	).toBe("Phone structured UAT");
	router.publish({ method: "item/started", params: { threadId: "primary", turnId: "turn", item: { id: "plain" } } });
	expect(sent.map(event => event.method)).toEqual([
		"thread/started",
		"item/tool/requestUserInput",
		"item/started",
		"item/completed",
	]);
	router.dispose();
});

test("blocking publication survives resolution and reconnect until its secondary owner closes", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "fixture", undefined, "primary");
	const sent: { client: string; event: Notification }[] = [];
	router.notify = (client, event) => sent.push({ client, event });
	router.registerSession("primary", { thread: { id: "primary" }, call: async () => ({}) });
	const secondary = {
		thread: { id: "secondary", name: "Phone structured UAT" },
		requests: [{ ...question, params: { ...question.params, threadId: "secondary" } }],
		call: async () => ({ thread: { id: "secondary" }, turns: [] }),
	};
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	router.registerSession("secondary", secondary);
	expect(sent.map(value => value.event.method)).toEqual(["thread/started", "item/tool/requestUserInput"]);
	router.publish({ method: "serverRequest/resolved", params: { threadId: "secondary", requestId: question.id } });
	expect(
		((await router.handle("phone", { id: 2, method: "thread/list", params: {} })) as any).result.data,
	).toHaveLength(2);
	router.close("phone");
	sent.length = 0;
	await router.handle("phone", {
		id: 3,
		method: "initialize",
		params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	await Bun.sleep(5);
	expect(sent.map(value => value.event.method)).toEqual(["thread/started"]);
	expect(router.subscribed("phone", "secondary")).toBe(true);
	expect(
		(await router.handle("phone", { id: 4, method: "thread/resume", params: { threadId: "secondary" } })) as any,
	).toMatchObject({ result: { thread: { id: "secondary" } } });
	router.removeSession("secondary");
	expect(sent.at(-1)?.event).toEqual({ method: "thread/closed", params: { threadId: "secondary" } });
	expect(router.subscribed("phone", "secondary")).toBe(false);
	router.dispose();
});

test("pending asynchronous registration republishes after host reconstruction without answer data", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "fixture", undefined, "primary");
	const sent: { client: string; event: Notification }[] = [];
	router.notify = (client, event) => sent.push({ client, event });
	router.registerSession("primary", { thread: { id: "primary" }, call: async () => ({}) });
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	router.registerSession("secondary", {
		thread: { id: "secondary", name: null },
		publishedInteraction: true,
		asyncInteractions: [
			{
				requestId: "request",
				questionId: "ask:0",
				title: "Phone structured UAT",
				identity: { sessionId: "secondary", threadId: "secondary", turnId: "turn", itemId: "ask", generation: 1 },
			},
		],
		call: async () => ({ thread: { id: "secondary" }, turns: [] }),
	});
	expect(sent.map(value => value.event.method)).toEqual(["thread/started", "item/tool/requestUserInput"]);
	expect((sent[0].event.params.thread as Record<string, unknown>).name).toBe("Phone structured UAT");
	expect(JSON.stringify(sent)).not.toContain("answer");
	router.registerSession("secondary", {
		thread: { id: "secondary" },
		publishedInteraction: true,
		asyncInteractions: [],
		call: async () => ({ thread: { id: "secondary" }, turns: [] }),
	});
	expect(sent.map(value => value.event.method)).toEqual([
		"thread/started",
		"item/tool/requestUserInput",
		"serverRequest/resolved",
	]);
	router.dispose();
});

test("a published secondary routes stable asynchronous receipts to its existing completion owner", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "fixture", undefined, "primary");
	const calls: unknown[][] = [];
	router.registerSession("primary", { thread: { id: "primary" }, call: async () => ({}) });
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	router.registerSession("secondary", {
		thread: { id: "secondary" },
		publishedInteraction: true,
		call: async (...args) => {
			calls.push(args);
			return { accepted: calls.length === 1 };
		},
	});
	const command = {
		type: "interaction_respond",
		requestId: "request",
		responseId: "response",
		identity: { sessionId: "secondary", threadId: "secondary", turnId: "turn", itemId: "ask", generation: 1 },
		value: "Beta",
	};
	expect(
		await router.handle("phone", {
			id: 2,
			method: "xcsh/interaction",
			params: { threadId: "secondary", command },
		}),
	).toEqual({ id: 2, result: { accepted: true } });
	expect(
		await router.handle("phone", {
			id: 3,
			method: "xcsh/interaction",
			params: { threadId: "secondary", command },
		}),
	).toEqual({ id: 3, result: { accepted: false } });
	expect(calls).toHaveLength(2);
	expect(calls[0].slice(1)).toEqual(["xcsh/interaction", { threadId: "secondary", command }]);
	router.dispose();
});
