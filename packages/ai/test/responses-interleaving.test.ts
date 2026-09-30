import { describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { processResponsesStream } from "../src/providers/openai-responses-shared";
import type { AssistantMessage, AssistantMessageEvent } from "../src/types";
import { AssistantMessageEventStream } from "../src/utils/event-stream";

async function run(events: unknown[]) {
	const output: AssistantMessage = {
		role: "assistant",
		api: "openai-responses",
		provider: "openai",
		model: "gpt-6.1-sol",
		content: [],
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
	const seen: AssistantMessageEvent[] = [];
	const stream = new AssistantMessageEventStream();
	const consume = (async () => {
		for await (const event of stream) seen.push(event);
	})();
	async function* source() {
		yield* events;
	}
	try {
		await processResponsesStream(source() as any, output, stream, getBundledModel("openai", "gpt-6.1-sol"));
	} finally {
		stream.end(output);
		await consume;
	}
	return { output, seen };
}
const completed = { type: "response.completed", response: { status: "completed", output: [] } };
describe("Responses output index lifecycle", () => {
	it("retains encrypted reasoning delivered only in the terminal response", async () => {
		const item = { type: "reasoning", id: "rs_synthetic", summary: [] };
		const result = await run([
			{ type: "response.output_item.added", output_index: 0, item },
			{ type: "response.output_item.done", output_index: 0, item },
			{
				type: "response.completed",
				response: { status: "completed", output: [{ ...item, encrypted_content: "synthetic-encrypted" }] },
			},
		]);
		expect(result.output.content[0]).toMatchObject({
			thinkingSignature: expect.stringContaining("synthetic-encrypted"),
		});
	});
	it("correlates interleaved function arguments and text to their own slots", async () => {
		const calls = [0, 1].map(index => ({
			type: "function_call",
			id: `fc_${index}`,
			call_id: `call_${index}`,
			name: `tool_${index}`,
			arguments: "",
		}));
		const result = await run([
			...calls.map((item, output_index) => ({ type: "response.output_item.added", output_index, item })),
			{ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"a":1}' },
			{ type: "response.function_call_arguments.delta", output_index: 1, delta: '{"b":2}' },
			...calls.map((item, output_index) => ({
				type: "response.output_item.done",
				output_index,
				item: { ...item, arguments: output_index === 0 ? '{"a":1}' : '{"b":2}' },
			})),
			completed,
		]);
		expect(result.output.content).toMatchObject([
			{ name: "tool_0", arguments: { a: 1 } },
			{ name: "tool_1", arguments: { b: 2 } },
		]);
		expect(result.seen.filter(event => event.type === "toolcall_delta").map(event => event.contentIndex)).toEqual([
			0, 1,
		]);
	});
	it("preserves custom tool input and namespace", async () => {
		const item = {
			type: "custom_tool_call",
			id: "fc_custom",
			call_id: "custom",
			name: "patch",
			namespace: "demo-app",
			input: "",
		};
		const result = await run([
			{ type: "response.output_item.added", output_index: 0, item },
			{ type: "response.custom_tool_call_input.delta", output_index: 0, delta: "synthetic patch" },
			{ type: "response.output_item.done", output_index: 0, item: { ...item, input: "synthetic patch" } },
			completed,
		]);
		expect(result.output.content).toMatchObject([
			{ type: "toolCall", name: "patch", namespace: "demo-app", arguments: { input: "synthetic patch" } },
		]);
	});
	it("refuses unfinished calls and non-terminal streams", async () => {
		const item = { type: "function_call", id: "fc_cut", call_id: "cut", name: "write", arguments: "" };
		await expect(run([{ type: "response.output_item.added", output_index: 0, item }, completed])).rejects.toThrow(
			"unfinished tool call",
		);
		await expect(run([{ type: "response.output_item.added", output_index: 0, item }])).rejects.toThrow("terminal");
	});
});
