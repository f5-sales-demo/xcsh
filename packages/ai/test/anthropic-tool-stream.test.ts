import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessageEvent, Context, Model, ToolCall } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-5",
	name: "Claude Sonnet 5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};

const context: Context = {
	messages: [{ role: "user", content: "Plan this", timestamp: Date.now() }],
};

function toolEvents(options: { inlineInput?: Record<string, unknown>; deltas?: string[] }): Record<string, unknown>[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_tool_stream",
				model: "claude-sonnet-5",
				usage: {
					input_tokens: 1,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: "tool_todo",
				name: "todo_write",
				input: options.inlineInput ?? {},
			},
		},
		...(options.deltas ?? []).map(partial_json => ({
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json },
		})),
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "tool_use" },
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		{ type: "message_stop" },
	];
}

function mockEvents(events: Record<string, unknown>[]): void {
	vi.spyOn(Messages.prototype, "create").mockImplementation(
		() =>
			({
				async withResponse() {
					return {
						data: {
							async *[Symbol.asyncIterator]() {
								for (const event of events) yield event;
							},
						},
						response: new Response(null, { status: 200 }),
						request_id: "req_tool_stream",
					};
				},
			}) as never,
	);
}

async function collect(events: Record<string, unknown>[]): Promise<{
	events: AssistantMessageEvent[];
	result: Awaited<ReturnType<ReturnType<typeof streamAnthropic>["result"]>>;
}> {
	mockEvents(events);
	const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test" });
	const received: AssistantMessageEvent[] = [];
	for await (const event of stream) received.push(event);
	return { events: received, result: await stream.result() };
}

function onlyToolCall(result: { content: unknown[] }): ToolCall {
	const block = result.content[0] as ToolCall | undefined;
	if (block?.type !== "toolCall") throw new Error("Expected one tool call");
	return block;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Anthropic terminal tool input parsing", () => {
	it("preserves fragmented valid arguments, escapes, Unicode, siblings, _i, and array-valued ops", async () => {
		const payload = {
			_i: "Trace 漢字 🚀",
			ops: [
				{
					op: "replace",
					text: 'quote=" slash=\\ bracket=] fence=```json\\n{}\\n```',
				},
			],
			sibling: { yaml: "key: value", embedded: '{"ok":true}' },
		};
		const encoded = JSON.stringify(payload);
		const splitPoints = [1, 9, 23, 51, 87, encoded.length - 3];
		const deltas = splitPoints.map((end, index) => encoded.slice(index === 0 ? 0 : splitPoints[index - 1], end));
		deltas.push(encoded.slice(splitPoints.at(-1)));

		const { result } = await collect(toolEvents({ deltas }));

		expect(result.stopReason).toBe("toolUse");
		expect(onlyToolCall(result).arguments).toEqual(payload);
	});

	it("retains inline input when no JSON deltas arrive", async () => {
		const inlineInput = { _i: "inline", ops: [{ op: "replace" }], sibling: true };

		const { result } = await collect(toolEvents({ inlineInput }));

		expect(result.stopReason).toBe("toolUse");
		expect(onlyToolCall(result).arguments).toEqual(inlineInput);
	});

	it("surfaces malformed completed JSON as a provider error instead of accepting a partial value", async () => {
		const malformed = '{"_i":"trace","ops":[{"op":"replace"}]';

		const { events, result } = await collect(toolEvents({ deltas: [malformed] }));

		expect(events.some(event => event.type === "toolcall_end")).toBe(false);
		expect(events.some(event => event.type === "error")).toBe(true);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("malformed completed tool input JSON");
		expect(result.errorMessage).toContain("todo_write");
	});

	it("continues best-effort parsing for in-progress previews", async () => {
		const payload = { _i: "trace", ops: [{ op: "replace" }] };
		const encoded = JSON.stringify(payload);
		const first = encoded.slice(0, encoded.indexOf("replace") + 3);
		const second = encoded.slice(first.length);
		mockEvents(toolEvents({ deltas: [first, second] }));
		const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test" });
		let preview: Record<string, unknown> | undefined;
		for await (const event of stream) {
			if (event.type === "toolcall_delta" && !preview) {
				const block = event.partial.content[0];
				if (block?.type === "toolCall") preview = structuredClone(block.arguments);
			}
		}
		const result = await stream.result();

		expect(preview).toMatchObject({ _i: "trace" });
		expect(onlyToolCall(result).arguments).toEqual(payload);
	});
});
