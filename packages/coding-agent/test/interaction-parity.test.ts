import { describe, expect, test } from "bun:test";
import { UserInteractions } from "../src/session/user-interactions";

describe("shared interaction completion", () => {
	test("external retries return the original receipt and cannot change the answer", async () => {
		const owner = new UserInteractions();
		const identity = { sessionId: "s", threadId: "t", turnId: "1", itemId: "i", generation: 2 };
		const result = owner.request({ kind: "input", title: "Answer", identity });
		const id = owner.pending()[0].id;
		expect(owner.respondExternal(id, "response", "answer", { ...identity, generation: 1 })).toBe(false);
		expect(owner.respondExternal(id, "response", "answer", identity)).toBe(true);
		expect(owner.respondExternal(id, "response", "answer", identity)).toBe(true);
		expect(owner.respondExternal(id, "response", "different", identity)).toBe(false);
		expect(owner.respondExternal(id, "another-response", "answer", identity)).toBe(false);
		expect(await result).toBe("answer");
	});
	test("local completion uses the same validator as remote completion", async () => {
		const owner = new UserInteractions();
		let complete!: (value: string | undefined) => void;
		const answer = owner.request({ kind: "select", title: "Choose", options: ["A", "B"] }, (_signal, done) => {
			complete = done;
			return new Promise(() => {});
		});
		const id = owner.pending()[0].id;
		complete("forged");
		expect(owner.pending()).toHaveLength(1);
		expect(owner.respond(id, "B")).toBe(true);
		complete("A");
		expect(await answer).toBe("B");
		expect(owner.respond(id, "A")).toBe(false);
	});

	test("headless requests remain available until explicit completion", async () => {
		const owner = new UserInteractions();
		const answer = owner.request({ kind: "input", title: "Answer" });
		await Promise.resolve();
		expect(owner.pending()).toHaveLength(1);
		expect(owner.respond(owner.pending()[0].id, "actual answer")).toBe(true);
		expect(await answer).toBe("actual answer");
	});

	test("resolution reasons and revision replay never disclose answers", async () => {
		const owner = new UserInteractions();
		const answer = owner.request({ kind: "input", title: "Secret", isSecret: true });
		const opened = owner.snapshot();
		expect(opened.pending).toHaveLength(1);
		owner.respond(opened.pending[0].id, "private-value");
		await answer;
		const replay = owner.replay(opened.revision);
		expect(replay.events).toHaveLength(1);
		expect(replay.events[0].reason).toBe("answered");
		expect(JSON.stringify(replay)).not.toContain("private-value");
		expect(replay.snapshot.pending).toEqual([]);
	});
});

test("async terminal presentation is explicit and remote completion closes the selected form", async () => {
	const owner = new UserInteractions();
	let shown = 0;
	let signal: AbortSignal | undefined;
	owner.setAsyncPresenter((_request, abort) => {
		shown++;
		signal = abort;
		return new Promise(() => {});
	});
	const result = owner.request({ kind: "input", delivery: "async", title: "Preferred region?" });
	const request = owner.pending()[0];
	expect(shown).toBe(0);
	expect(owner.waitingOnUserInput).toBe(false);
	expect(owner.presentAsync(request.id)).toBe(true);
	expect(shown).toBe(1);
	expect(owner.respond(request.id, "Canada")).toBe(true);
	expect(await result).toBe("Canada");
	expect(signal?.aborted).toBe(true);
	expect(owner.presentAsync(request.id)).toBe(false);
});

test("receipt is installed before resolution observers can retry", async () => {
	const owner = new UserInteractions();
	const identity = { sessionId: "s", threadId: "t", turnId: "u", itemId: "i", generation: 1 };
	const result = owner.request({ kind: "input", title: "Q", identity });
	const id = owner.pending()[0].id;
	let retry = false;
	owner.subscribe(event => {
		if (event.type === "resolved") retry = owner.respondExternal(id, "receipt", "Yes", identity);
	});
	expect(owner.respondExternal(id, "receipt", "Yes", identity)).toBe(true);
	expect(retry).toBe(true);
	expect(await result).toBe("Yes");
	expect(owner.respondExternal(id, "receipt", undefined, identity)).toBe(false);
});

test("restart recovery closes lost owners and retains monotonic resolution replay", async () => {
	const first = new UserInteractions();
	const result = first.request({ kind: "input", title: "Unanswered", delivery: "async" });
	const history = first.replay(0).events;
	const restored = new UserInteractions();
	restored.recover(history);
	expect(restored.pending()).toEqual([]);
	expect(restored.snapshot().revision).toBe(2);
	expect(restored.replay(0).events.at(-1)).toMatchObject({
		type: "resolved",
		reason: "owner_lost",
		interaction: { id: history[0].interaction.id },
	});
	expect(restored.respond(history[0].interaction.id, "late")).toBe(false);
	first.close();
	await result;
});

test("session restoration clears response receipts and restarts revision scope", async () => {
	const owner = new UserInteractions();
	const firstIdentity = { sessionId: "first", threadId: "first", turnId: "1", itemId: "a", generation: 1 };
	const first = owner.request({ kind: "input", title: "First", identity: firstIdentity });
	const firstId = owner.pending()[0].id;
	expect(owner.respondExternal(firstId, "shared-receipt", "A", firstIdentity)).toBe(true);
	expect(await first).toBe("A");
	expect(owner.snapshot().revision).toBe(2);

	owner.restore([]);
	expect(owner.snapshot()).toEqual({ revision: 0, pending: [] });
	const secondIdentity = { sessionId: "second", threadId: "second", turnId: "1", itemId: "b", generation: 1 };
	const second = owner.request({ kind: "input", title: "Second", identity: secondIdentity });
	const secondId = owner.pending()[0].id;
	expect(owner.respondExternal(secondId, "shared-receipt", "B", secondIdentity)).toBe(true);
	expect(await second).toBe("B");
});
