import { expect, test } from "bun:test";
import { UserInteractions } from "../src/session/user-interactions";

test("recovered receipts retain safe answer presentation and delivery state without replaying answers", async () => {
	const owner = new UserInteractions();
	const identity = { sessionId: "s", threadId: "s", turnId: "turn", itemId: "call", generation: 0 };
	const answer = owner.request({
		kind: "input",
		delivery: "async",
		questionId: "q",
		title: "Secret?",
		isSecret: true,
		identity,
	});
	const request = owner.pending()[0]!;
	expect(owner.respondExternal(request.id, "receipt", "synthetic secret", identity)).toBe(true);
	expect(await answer).toBe("synthetic secret");
	owner.updateAnswerPresentation("call", "q", "queued");
	const restored = new UserInteractions();
	restored.recover(owner.replay(0).events);
	expect(restored.snapshot().presentations?.[0]?.recap.state).toBe("queued");
	expect(JSON.stringify(restored.snapshot())).not.toContain("synthetic secret");
	restored.updateAnswerPresentation("call", "q", "failed");
	expect(restored.snapshot().presentations?.[0]?.recap.state).toBe("failed");
	expect(restored.pending()).toEqual([]);
	owner.close();
	restored.close();
});
