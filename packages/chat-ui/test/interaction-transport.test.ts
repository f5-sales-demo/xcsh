import { expect, test } from "bun:test";
import { isInteractionCommand, isInteractionFrame } from "../src/interactions/transport";

const identity = { sessionId: "s", threadId: "t", turnId: "u", itemId: "i", generation: 1 };
test("transport rejects malformed nested interactions before clients render them", () => {
	for (const frame of [
		{ type: "interaction_event", revision: 1, event: {} },
		{ type: "interaction_snapshot", sessionId: "s", revision: -1, pending: [] },
		{ type: "interaction_snapshot", sessionId: "s", revision: 1, pending: [{}] },
		{ type: "plan_available", plan: {} },
		{
			type: "interaction_event",
			revision: 1,
			event: {
				type: "opened",
				interaction: { id: "r", kind: "request_user_input", title: "Q", inputQuestions: [{}] },
			},
		},
	])
		expect(isInteractionFrame(frame)).toBe(false);
	expect(isInteractionFrame({ type: "interaction_snapshot", sessionId: "s", revision: 0, pending: [] })).toBe(true);
});
test("responses require complete identity and a stable receipt ID", () => {
	const command = { type: "interaction_respond", requestId: "r", responseId: "receipt", identity, value: "Yes" };
	expect(isInteractionCommand(command)).toBe(true);
	expect(isInteractionCommand({ ...command, identity: { sessionId: "s" } })).toBe(false);
	expect(isInteractionCommand({ ...command, responseId: undefined })).toBe(false);
	expect(isInteractionCommand({ type: "plan_decide", planId: "p", responseId: "r", action: "surprise" })).toBe(false);
});
