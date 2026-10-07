import { expect, test } from "bun:test";
import { UserInteractions } from "../src/session/user-interactions";
import { RequestUserInputAsyncTool } from "../src/tools/request-user-input";

const identity = { sessionId: "s", threadId: "s", turnId: "1", itemId: "choice", generation: 0 };

test("required input matrix: independent work continues, silence and blank replies leave choices pending", async () => {
	const owner = new UserInteractions();
	let delivered = false;
	const tool = new RequestUserInputAsyncTool({
		settings: { get: () => false },
		getUserInteractions: () => owner,
		getInteractionIdentity: () => identity,
		deliverAsyncAnswer: async () => {
			delivered = true;
		},
	} as any);
	expect(
		(
			await tool.execute("choice", {
				questions: [{ title: "Choose required environment", options: ["Staging", "Production"] }],
			})
		).content,
	).toEqual([{ type: "text", text: '{"accepted":true}' }]);
	let independent = 0;
	await Promise.resolve().then(() => independent++);
	expect(independent).toBe(1);
	expect(owner.waitingOnUserInput).toBe(false);
	await Bun.sleep(0);
	expect(delivered).toBe(false);
	const request = owner.pending()[0];
	expect(owner.respondExternal(request.id, "blank", "  ", identity)).toBe(false);
	expect(owner.pending()).toHaveLength(1);
	owner.cancelAll();
	await Bun.sleep(0);
	expect(delivered).toBe(false);
});

for (const timing of ["streaming", "idle"] as const) {
	test(`required input matrix: ${timing} reply resumes only its correlated choice`, async () => {
		const owner = new UserInteractions();
		const replies: unknown[][] = [];
		const tool = new RequestUserInputAsyncTool({
			settings: { get: () => false },
			getUserInteractions: () => owner,
			getInteractionIdentity: () => identity,
			deliverAsyncAnswer: async (...args: unknown[]) => {
				replies.push(args);
			},
		} as any);
		await tool.execute("choice", { questions: [{ title: "Required name" }] });
		if (timing === "idle") await Bun.sleep(0);
		const request = owner.pending()[0];
		expect(owner.respondExternal(request.id, "receipt", "Maple", identity)).toBe(true);
		await Bun.sleep(0);
		expect(replies).toEqual([["choice", '["request_user_input_async","choice",0]', "Maple"]]);
	});
}

test("required input matrix: competing clients, duplicate receipts and stale identities resolve once", async () => {
	const owner = new UserInteractions();
	const result = owner.request({ kind: "input", delivery: "async", title: "Choose", identity });
	const request = owner.pending()[0];
	expect(owner.respondExternal(request.id, "stale", "A", { ...identity, generation: 1 })).toBe(false);
	const accepted = await Promise.all([
		Promise.resolve().then(() => owner.respondExternal(request.id, "client-a", "A", identity)),
		Promise.resolve().then(() => owner.respondExternal(request.id, "client-b", "B", identity)),
	]);
	expect(accepted).toEqual([true, false]);
	expect(owner.respondExternal(request.id, "client-a", "A", identity)).toBe(true);
	expect(owner.respondExternal(request.id, "client-a", "B", identity)).toBe(false);
	expect(await result).toBe("A");
	expect(owner.pending()).toEqual([]);
});

test("required input matrix: cancellation checks identity and never submits the highlighted answer", async () => {
	const owner = new UserInteractions();
	const result = owner.request({
		kind: "input",
		delivery: "async",
		title: "Choose",
		options: ["Recommended"],
		identity,
	});
	const request = owner.pending()[0];
	expect(owner.cancelExternal(request.id, { ...identity, itemId: "stale" })).toBe(false);
	expect(owner.pending()).toHaveLength(1);
	expect(owner.cancelExternal(request.id, identity)).toBe(true);
	expect(await result).toBeUndefined();
	expect(owner.respondExternal(request.id, "late", "Recommended", identity)).toBe(false);
});
