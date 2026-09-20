import { expect, test } from "bun:test";
import { messageHistoryItems } from "../../src/remote-control/history";

test("replay preserves structured async questions and their original item identity", () => {
	const item = {
		id: "call",
		type: "agentMessage",
		text: "Where?",
		phase: "final_answer",
		delivery: "async",
		questions: [{ title: "Where?", options: ["Canada", "US"] }],
	};
	const result = messageHistoryItems("storage-id", {
		role: "custom",
		customType: "async-user-input",
		content: item.text,
		display: true,
		details: { item, questionIds: ["call:0"] },
		timestamp: 1,
	});
	expect(result).toEqual([item]);
});
