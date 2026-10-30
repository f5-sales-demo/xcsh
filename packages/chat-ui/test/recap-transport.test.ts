import { expect, test } from "bun:test";
import { isInteractionFrame } from "../src/interactions/transport";

const frame = {
	type: "interaction_event",
	revision: 1,
	event: {
		type: "resolved",
		interaction: { id: "q", kind: "input", title: "Question?" },
		reason: "answered",
		presentation: { state: "recorded", rows: [{ id: "q", topic: "Topic", question: "Question?", answer: "Answer" }] },
		presentationEvidence: "safe",
	},
};
test("valid safe recap metadata crosses the frame guard", () => expect(isInteractionFrame(frame)).toBe(true));
test("malformed recap metadata is rejected before rendering", () => {
	expect(isInteractionFrame({ ...frame, event: { ...frame.event, presentation: { state: "bogus", rows: [] } } })).toBe(
		false,
	);
	expect(isInteractionFrame({ ...frame, event: { ...frame.event, presentationEvidence: {} } })).toBe(false);
	expect(
		isInteractionFrame({ ...frame, event: { ...frame.event, presentation: { state: "recorded", rows: [{}] } } }),
	).toBe(false);
});
