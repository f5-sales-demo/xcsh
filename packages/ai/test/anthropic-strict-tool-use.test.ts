import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { Type } from "@sinclair/typebox";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Context, Model, Tool } from "../src/types";

type RequestParams = {
	tools?: Array<{ name: string; input_schema: Record<string, unknown>; strict?: boolean }>;
	tool_choice?: { type: string; name?: string };
};

function model(id = "claude-sonnet-5"): Model<"anthropic-messages"> {
	return {
		id,
		name: id,
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	};
}

const strictTool: Tool = {
	name: "todo_write",
	description: "Write a todo list",
	strict: true,
	parameters: Type.Object({
		ops: Type.Array(Type.Object({ op: Type.Literal("replace") })),
		note: Type.Optional(Type.String()),
	}),
};

const nonStrictTool: Tool = {
	name: "read",
	description: "Read a file",
	parameters: Type.Object({ path: Type.String() }),
};

function successEvents(): Record<string, unknown>[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_request_capture",
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
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
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

async function captureRequest(options: {
	modelId?: string;
	tools?: Tool[];
	toolChoice?: "auto" | { type: "tool"; name: string };
	oauth?: boolean;
}): Promise<RequestParams> {
	let captured: RequestParams | undefined;
	vi.spyOn(Messages.prototype, "create").mockImplementation(params => {
		captured = params as RequestParams;
		return {
			async withResponse() {
				return {
					data: {
						async *[Symbol.asyncIterator]() {
							for (const event of successEvents()) yield event;
						},
					},
					response: new Response(null, { status: 200 }),
					request_id: "req_capture",
				};
			},
		} as never;
	});
	const context: Context = {
		messages: [{ role: "user", content: "Plan this", timestamp: Date.now() }],
		tools: options.tools ?? [strictTool, nonStrictTool],
	};
	const stream = streamAnthropic(model(options.modelId), context, {
		apiKey: options.oauth ? "sk-ant-oat-test" : "sk-ant-test",
		toolChoice: options.toolChoice,
	});
	for await (const _event of stream) {
		// Drain the provider stream.
	}
	await stream.result();
	if (!captured) throw new Error("Anthropic request was not captured");
	return captured;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Anthropic strict tool use", () => {
	it("marks only the explicitly forced strict tool strict on supported models", async () => {
		const request = await captureRequest({ toolChoice: { type: "tool", name: "todo_write" } });

		expect(request.tool_choice).toEqual({ type: "tool", name: "todo_write" });
		expect(request.tools?.[0]?.strict).toBe(true);
		expect(request.tools?.[0]?.input_schema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["ops", "note"],
		});
		expect(request.tools?.[1]?.strict).toBeUndefined();
	});

	it("preserves OAuth tool-name prefixing for strict forced tools", async () => {
		const request = await captureRequest({
			toolChoice: { type: "tool", name: "todo_write" },
			oauth: true,
		});

		expect(request.tool_choice).toEqual({ type: "tool", name: "proxy_todo_write" });
		expect(request.tools?.[0]).toMatchObject({ name: "proxy_todo_write", strict: true });
		expect(request.tools?.[1]).toMatchObject({ name: "proxy_read" });
		expect(request.tools?.[1]?.strict).toBeUndefined();
	});

	it("leaves tools non-strict for automatic selection", async () => {
		const request = await captureRequest({ toolChoice: "auto" });

		expect(request.tools?.every(tool => tool.strict === undefined)).toBe(true);
	});

	it("leaves a forced tool non-strict when the tool does not opt in", async () => {
		const request = await captureRequest({ toolChoice: { type: "tool", name: "read" } });

		expect(request.tools?.every(tool => tool.strict === undefined)).toBe(true);
	});

	it.each(["claude-3-7-sonnet-latest", "claude-future-unknown"])(
		"falls back to non-strict for unsupported model %s",
		async modelId => {
			const request = await captureRequest({ modelId, toolChoice: { type: "tool", name: "todo_write" } });

			expect(request.tools?.every(tool => tool.strict === undefined)).toBe(true);
		},
	);

	it("falls back when strict schema adaptation cannot represent the tool schema", async () => {
		const unrepresentable: Tool = {
			...strictTool,
			parameters: Type.Object({ payload: Type.Unsafe({}) }),
		};
		const request = await captureRequest({
			tools: [unrepresentable],
			toolChoice: { type: "tool", name: "todo_write" },
		});

		expect(request.tools?.[0]?.strict).toBeUndefined();
	});

	it("falls back when the adapted schema exceeds Anthropic union limits", async () => {
		const properties = Object.fromEntries(
			Array.from({ length: 17 }, (_, index) => [`optional_${index}`, Type.Optional(Type.String())]),
		);
		const overLimit: Tool = {
			...strictTool,
			parameters: Type.Object(properties),
		};
		const request = await captureRequest({
			tools: [overLimit],
			toolChoice: { type: "tool", name: "todo_write" },
		});

		expect(request.tools?.[0]?.strict).toBeUndefined();
		expect(request.tools?.[0]?.input_schema.required).toEqual([]);
	});

	it("does not approach the 20-strict-tool limit when many tools are available", async () => {
		const tools = Array.from(
			{ length: 25 },
			(_, index): Tool => ({
				...strictTool,
				name: index === 24 ? "todo_write" : `tool_${index}`,
			}),
		);
		const request = await captureRequest({ tools, toolChoice: { type: "tool", name: "todo_write" } });

		expect(request.tools?.filter(tool => tool.strict).map(tool => tool.name)).toEqual(["todo_write"]);
	});
});
