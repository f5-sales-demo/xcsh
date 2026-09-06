import { describe, expect, test } from "bun:test";
import { sanitizeOpenAIResponsesHistoryItemsForReplay } from "../src/utils";

describe("OpenAI Responses replay status sanitization", () => {
	test("strips output-only statuses without mutating persisted history", () => {
		const persisted = [
			{
				type: "message",
				id: "msg_1",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "answer" }],
			},
			{
				type: "function_call",
				id: "fc_1",
				call_id: "call_1",
				name: "read",
				arguments: "{}",
				status: "completed",
			},
			{
				type: "custom_tool_call",
				id: "ctc_1",
				call_id: "call_2",
				name: "apply_patch",
				input: "patch",
				status: "completed",
			},
			{ type: "compaction", encrypted_content: "opaque", status: "completed" },
			{ type: "compaction_summary", summary: "summary", status: "completed" },
			{ type: "web_search_call", id: "ws_1", status: "completed" },
		] satisfies Array<Record<string, unknown>>;

		const replay = sanitizeOpenAIResponsesHistoryItemsForReplay(persisted) as Array<Record<string, unknown>>;

		for (const type of ["message", "function_call", "custom_tool_call", "compaction", "compaction_summary"]) {
			const item = replay.find(candidate => candidate.type === type);
			expect(item).toBeDefined();
			expect(item).not.toHaveProperty("status");
		}
		expect(replay.find(item => item.type === "web_search_call")?.status).toBe("completed");
		expect(persisted.every(item => item.status === "completed")).toBe(true);
		expect(persisted[0]?.id).toBe("msg_1");
	});
});
