import { expect, it } from "bun:test";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { requestAnthropicCompaction } from "../src/session/compaction/anthropic";

it("requests a signed summary with compatible summarization controls and preserves the native block", async () => {
	let body: any;
	const block = {
		type: "compaction",
		content: "Exact\r\nsummary",
		signature: "synthetic-signature",
		tool_changes: [],
	};
	const events = [
		{
			type: "message_start",
			message: { id: "msg_compact", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 0 } },
		},
		{ type: "content_block_start", index: 0, content_block: block },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "compaction" }, usage: { output_tokens: 3 } },
		{ type: "message_stop" },
	];
	const client = {
		messages: {
			create: (value: any) => {
				body = value;
				return {
					async withResponse() {
						return {
							data: {
								async *[Symbol.asyncIterator]() {
									yield* events;
								},
							},
							response: new Response(null, { status: 200 }),
						};
					},
				};
			},
		},
	};
	const result = await requestAnthropicCompaction(
		getBundledModel("anthropic", "claude-opus-5-5") as any,
		"synthetic",
		{ messages: [{ role: "user", content: "fixture", timestamp: 1 }] },
		undefined,
		undefined,
		{
			client: client as any,
			thinkingEnabled: true,
			effort: "high",
			outputFormat: { type: "json_schema", schema: { type: "object" } },
			taskBudget: { type: "tokens", total: 1000, remaining: 500 },
			serviceTier: "priority",
			toolChoice: { type: "tool", name: "synthetic" },
			contextManagement: { edits: [{ type: "clear_thinking_20251015" }] },
		},
	);
	expect(body.compaction).toEqual({ type: "summarize" });
	expect(body.thinking).toMatchObject({ type: "adaptive", display: "summarized" });
	expect(body.output_config).toEqual({ effort: "high", task_budget: { type: "tokens", total: 1000 } });
	expect(body.speed).toBe("fast");
	expect(body.max_tokens).toBe(128000);
	expect(body.context_management).toBeUndefined();
	expect(body.tool_choice).toEqual({ type: "auto" });
	expect(result.payload.blocks).toEqual([block]);
	expect(result.summary).toBe(block.content);
});
