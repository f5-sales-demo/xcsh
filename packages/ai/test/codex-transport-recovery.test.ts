import { afterEach, expect, it, vi } from "bun:test";
import { Type } from "@sinclair/typebox";
import { agentLoop } from "../../agent/src/agent-loop";
import { streamProxy } from "../../agent/src/proxy";
import { enrichModelThinking } from "../src/model-thinking";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses";
import type { Model } from "../src/types";
import { isRetryableError } from "../src/utils/retry";

const originalFetch = global.fetch;
const originalIdle = process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS;
afterEach(() => {
	global.fetch = originalFetch;
	if (originalIdle === undefined) delete process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS;
	else process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = originalIdle;
	vi.restoreAllMocks();
});
const socketMessage =
	"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
const token = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic" } })).toBase64()}.test`;
const model: Model<"openai-codex-responses"> = enrichModelThinking({
	id: "gpt-6.1-sol",
	name: "Sol",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
});
const context = { messages: [{ role: "user" as const, content: "Synthetic request", timestamp: 0 }] };
const frame = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const success = [
	{ type: "response.output_item.added", item: { type: "message", id: "answer", role: "assistant", content: [] } },
	{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
	{ type: "response.output_text.delta", delta: "Recovered" },
	{
		type: "response.output_item.done",
		item: { type: "message", id: "answer", role: "assistant", content: [{ type: "output_text", text: "Recovered" }] },
	},
	{
		type: "response.completed",
		response: { id: "final", status: "completed", usage: { input_tokens: 2, output_tokens: 1 } },
	},
];
const placeholders = [
	{ type: "response.created", response: { id: "abandoned", model: "abandoned-model" } },
	...Array.from({ length: 22 }, (_, i) => [
		{
			type: "response.output_item.added",
			output_index: i,
			item: { type: "reasoning", id: `empty-${i}`, summary: [] },
		},
		{
			type: "response.output_item.done",
			output_index: i,
			item: { type: "reasoning", id: `empty-${i}`, summary: [] },
		},
	]).flat(),
];
function response(events: object[], failure?: Error) {
	let index = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index < events.length) controller.enqueue(frame(events[index++]));
			else if (failure) controller.error(failure);
			else controller.close();
		},
	});
	return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
function setup(attempts: Array<Response | Error>) {
	const bodies: string[] = [];
	const headers: Headers[] = [];
	const times: number[] = [];
	global.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
		bodies.push(String(init?.body));
		headers.push(new Headers(init?.headers));
		times.push(Date.now());
		const next = attempts.shift();
		if (next instanceof Error) throw next;
		if (!next) throw new Error("Unexpected extra request");
		return next;
	}) as unknown as typeof fetch;
	return { bodies, headers, times };
}
async function run(signal?: AbortSignal) {
	const stream = streamOpenAICodexResponses(model, context, {
		apiKey: token,
		preferWebsockets: false,
		reasoning: "medium",
		signal,
	});
	const events = [];
	for await (const event of stream) events.push(event);
	return { result: await stream.result(), events };
}
it("recovers metadata and 22 empty reasoning blocks without abandoned history", async () => {
	const capture = setup([response(placeholders, new Error(socketMessage)), response(success)]);
	const { result, events } = await run();
	expect(result.stopReason).toBe("stop");
	expect(result.content).toHaveLength(1);
	expect(result.content[0]).toMatchObject({ type: "text", text: "Recovered" });
	expect(result.responseId).toBe("final");
	expect(result.responseAttribution).toEqual({ requestedModel: model.id });
	expect(JSON.stringify(result.providerPayload)).not.toContain("empty-");
	expect(capture.bodies).toHaveLength(2);
	expect(capture.bodies[1]).toBe(capture.bodies[0]);
	expect(capture.headers[1].get("authorization")).toBe(capture.headers[0].get("authorization"));
	expect(events.filter(e => e.type === "done" || e.type === "error")).toHaveLength(1);
	expect(events.filter(e => e.type === "text_delta")).toHaveLength(1);
	expect(events.filter(e => e.type.startsWith("thinking_"))).toHaveLength(0);
	expect(events.filter(e => e.type === "start")).toHaveLength(1);
});
it("exhausts exactly two restarts with increasing backoff and original detail", async () => {
	const capture = setup(Array.from({ length: 3 }, () => response([], new Error(socketMessage))));
	const { result, events } = await run();
	expect(capture.bodies).toHaveLength(3);
	expect(result.errorMessage).toContain(socketMessage);
	expect(capture.times[1] - capture.times[0]).toBeGreaterThanOrEqual(450);
	expect(capture.times[2] - capture.times[1]).toBeGreaterThanOrEqual(950);
	expect(events.filter(e => e.type === "error")).toHaveLength(1);
});
for (const [name, prefix] of [
	["visible text", success.slice(0, 3)],
	[
		"visible reasoning",
		[
			{ type: "response.output_item.added", item: { type: "reasoning", id: "r", summary: [] } },
			{ type: "response.reasoning_summary_text.delta", delta: "Thinking" },
		],
	],
	[
		"tool start",
		[
			{
				type: "response.output_item.added",
				item: { type: "function_call", id: "tool", call_id: "call", name: "synthetic", arguments: "" },
			},
		],
	],
] as const)
	it(`does not replay after ${name}`, async () => {
		const capture = setup([response([...prefix], new Error(socketMessage))]);
		expect((await run()).result.stopReason).toBe("error");
		expect(capture.bodies).toHaveLength(1);
	});
it("cancels during backoff without reopening", async () => {
	const setTimer = vi.spyOn(globalThis, "setTimeout");
	const clearTimer = vi.spyOn(globalThis, "clearTimeout");
	const capture = setup([response([], new Error(socketMessage))]);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 100);
	try {
		const { result, events } = await run(controller.signal);
		expect(result.stopReason).toBe("aborted");
		expect(events.filter(e => e.type === "error" || e.type === "done")).toHaveLength(1);
		const backoffIndex = setTimer.mock.calls.findIndex(call => call[1] === 500);
		expect(backoffIndex).toBeGreaterThanOrEqual(0);
		expect(clearTimer.mock.calls.some(call => call[0] === setTimer.mock.results[backoffIndex].value)).toBe(true);
	} finally {
		clearTimeout(timer);
	}
	expect(capture.bodies).toHaveLength(1);
});
it("recognizes exact socket and structured reset errors but preserves validation", () => {
	expect(isRetryableError(new Error(socketMessage))).toBe(true);
	expect(isRetryableError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
	expect(isRetryableError(new Error("fetch failed", { cause: { code: "ERR_STREAM_PREMATURE_CLOSE" } }))).toBe(true);
	expect(isRetryableError({ status: 401, message: socketMessage })).toBe(false);
	expect(isRetryableError({ message: "invalid request", code: "ECONNRESET" })).toBe(false);
});

it("recovers a premature EOF after empty text placeholders and releases abandoned readers", async () => {
	const abandoned = response([
		{
			type: "response.output_item.added",
			item: { type: "message", id: "empty-text", role: "assistant", content: [] },
		},
		{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
	]);
	setup([abandoned, response(success)]);
	expect((await run()).result.stopReason).toBe("stop");
	expect(abandoned.body?.locked).toBe(false);
});
it("counts failed reopen operations against the same two-restart budget", async () => {
	const capture = setup([
		response([], new Error(socketMessage)),
		Object.assign(new Error("reset on reopen"), { code: "ECONNRESET" }),
		response(success),
	]);
	expect((await run()).result.stopReason).toBe("stop");
	expect(capture.bodies).toHaveLength(3);
});
it("retains the original failure when both reopen operations fail", async () => {
	const capture = setup([
		response([], new Error(socketMessage)),
		Object.assign(new Error("first reopen"), { code: "ECONNRESET" }),
		Object.assign(new Error("second reopen"), { code: "ECONNRESET" }),
	]);
	expect((await run()).result.errorMessage).toContain(socketMessage);
	expect(capture.bodies).toHaveLength(3);
});
it("does not recover authentication or cancellation failures", async () => {
	for (const failure of [
		Object.assign(new Error(socketMessage), { status: 401 }),
		Object.assign(new Error(socketMessage), { name: "AbortError" }),
	]) {
		const capture = setup([response([], failure)]);
		expect((await run()).result.stopReason).toBe("error");
		expect(capture.bodies).toHaveLength(1);
	}
});
it("does not replay completed native tool activity", async () => {
	const capture = setup([response([{ type: "response.web_search_call.in_progress" }], new Error(socketMessage))]);
	expect((await run()).result.stopReason).toBe("error");
	expect(capture.bodies).toHaveLength(1);
});

it("replays completed tool context without emitting or executing the tool again", async () => {
	const capture = setup([response(placeholders, new Error(socketMessage)), response(success)]);
	const completedToolContext = {
		messages: [
			...context.messages,
			{
				role: "assistant" as const,
				content: [{ type: "toolCall" as const, id: "completed|item", name: "synthetic", arguments: {} }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse" as const,
				timestamp: 0,
			},
			{
				role: "toolResult" as const,
				toolCallId: "completed|item",
				toolName: "synthetic",
				content: [{ type: "text" as const, text: "Already completed" }],
				isError: false,
				timestamp: 0,
			},
		],
	};
	const stream = streamOpenAICodexResponses(model, completedToolContext, { apiKey: token, preferWebsockets: false });
	const events = [];
	for await (const event of stream) events.push(event);
	expect((await stream.result()).stopReason).toBe("stop");
	expect(capture.bodies[1]).toBe(capture.bodies[0]);
	expect(capture.bodies[1]).toContain("Already completed");
	expect(events.filter(event => event.type.startsWith("toolcall"))).toHaveLength(0);
});

it("serializes recovered provider events through streamProxy without abandoned placeholders", async () => {
	setup([response(placeholders, new Error(socketMessage)), response(success)]);
	const { events } = await run();
	const wire = events.map(event => {
		if (event.type === "done") return { type: event.type, reason: event.reason, usage: event.message.usage };
		if (event.type === "error") return { type: event.type, reason: event.reason, usage: event.error.usage };
		const { partial, ...rest } = event;
		return rest;
	});
	setup([response(wire)]);
	const proxy = streamProxy(model, context, { authToken: "synthetic", proxyUrl: "https://proxy.example" });
	const forwarded = [];
	for await (const event of proxy) forwarded.push(event);
	expect((await proxy.result()).content).toEqual([
		{ type: "text", text: "Recovered", phase: "final_answer", textSignature: undefined },
	]);
	expect(forwarded.filter(e => e.type === "text_delta")).toHaveLength(1);
	expect(forwarded.filter(e => e.type === "done" || e.type === "error")).toHaveLength(1);
});

function hangingResponse(events: object[] = [], onCancel?: () => void) {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const event of events) controller.enqueue(frame(event));
			},
			cancel() {
				onCancel?.();
			},
		}),
	);
}
for (const [name, prefix] of [
	["first event", []],
	["metadata", placeholders.slice(0, 1)],
	["empty placeholders", placeholders],
] as const)
	it(`recovers idle timeout after ${name} with a fresh attempt signal`, async () => {
		process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "20";
		let cancelled = 0;
		const abandoned = hangingResponse([...prefix], () => cancelled++);
		const capture = setup([abandoned, response(success)]);
		const caller = new AbortController();
		const { result, events } = await run(caller.signal);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toHaveLength(1);
		expect(caller.signal.aborted).toBe(false);
		expect(capture.bodies).toHaveLength(2);
		expect(abandoned.body?.locked).toBe(false);
		expect(cancelled).toBe(1);
		expect(events.filter(e => e.type.startsWith("thinking_"))).toHaveLength(0);
	});
it("cancels a pending first read with the watchdog disabled and unlocks its reader", async () => {
	process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "0";
	const abandoned = hangingResponse();
	const capture = setup([abandoned]);
	const caller = new AbortController();
	const timer = setTimeout(() => caller.abort(), 20);
	try {
		const { result, events } = await run(caller.signal);
		expect(result.stopReason).toBe("aborted");
		expect(events.filter(e => e.type === "error")).toHaveLength(1);
		expect(capture.bodies).toHaveLength(1);
		expect(abandoned.body?.locked).toBe(false);
	} finally {
		clearTimeout(timer);
	}
});

it("preserves successful empty encrypted reasoning and interleaved content indices", async () => {
	const reasoning = { type: "reasoning", id: "encrypted", summary: [], encrypted_content: "synthetic-cipher" };
	setup([
		response([
			{ type: "response.output_item.added", output_index: 7, item: reasoning },
			{ ...success[0], output_index: 3 },
			{ ...success[1], output_index: 3 },
			{ ...success[2], output_index: 3 },
			{ type: "response.output_item.done", output_index: 7, item: reasoning },
			{ ...success[3], output_index: 3 },
			success[4],
		]),
	]);
	const { result, events } = await run();
	expect(result.content).toHaveLength(2);
	expect(result.content[0]).toMatchObject({ type: "thinking", thinking: "" });
	expect(JSON.stringify(result.providerPayload)).toContain("synthetic-cipher");
	expect(events.filter(e => "contentIndex" in e).map(e => e.contentIndex)).toEqual([0, 1, 1, 0, 1]);
});
it("flushes successful empty text and reasoning on terminal completion", async () => {
	setup([response([...placeholders.slice(1, 3), ...success.slice(0, 2), success[4]])]);
	const { result, events } = await run();
	expect(result.content).toHaveLength(2);
	expect(events.map(e => e.type)).toEqual(["start", "thinking_start", "thinking_end", "text_start", "done"]);
});
it("shares exhaustion budget between socket, idle and reopening failures", async () => {
	process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "20";
	const capture = setup([
		response(placeholders, new Error(socketMessage)),
		hangingResponse(placeholders),
		Object.assign(new Error("reopen reset"), { code: "ECONNRESET" }),
	]);
	const { result, events } = await run();
	expect(result.errorMessage).toContain(socketMessage);
	expect(capture.bodies).toHaveLength(3);
	expect(events.filter(e => e.type === "error")).toHaveLength(1);
});
it("does not replay a terminal event followed by socket closure", async () => {
	const capture = setup([response([success[4]], new Error(socketMessage))]);
	expect((await run()).result.stopReason).toBe("error");
	expect(capture.bodies).toHaveLength(1);
});
it("does not request when already cancelled", async () => {
	const capture = setup([]);
	const caller = new AbortController();
	caller.abort();
	const { result, events } = await run(caller.signal);
	expect(result.stopReason).toBe("aborted");
	expect(capture.bodies).toHaveLength(0);
	expect(events.filter(e => e.type === "error")).toHaveLength(1);
});
it("cancels during reopening without any later request", async () => {
	const caller = new AbortController();
	let requests = 0;
	global.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
		requests++;
		if (requests === 1) return response([], new Error(socketMessage));
		return new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
			caller.abort();
		});
	}) as unknown as typeof fetch;
	const { result, events } = await run(caller.signal);
	expect(result.stopReason).toBe("aborted");
	expect(requests).toBe(2);
	expect(events.filter(e => e.type === "error")).toHaveLength(1);
});
it("cleanup cannot hang on an upstream cancel hook", async () => {
	process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "20";
	const abandoned = new Response(
		new ReadableStream<Uint8Array>({
			cancel() {
				return new Promise(() => {});
			},
		}),
	);
	setup([abandoned, response(success)]);
	expect((await run()).result.stopReason).toBe("stop");
	expect(abandoned.body?.locked).toBe(false);
});

it("does not time out while a raw event callback is processing", async () => {
	process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "20";
	const capture = setup([response(success)]);
	const provider = streamOpenAICodexResponses(model, context, {
		apiKey: token,
		preferWebsockets: false,
		onProviderStreamEvent: async () => {
			await new Promise(resolve => setTimeout(resolve, 30));
		},
	});
	for await (const _event of provider) {
		/* Consume the actual stream. */
	}
	expect((await provider.result()).stopReason).toBe("stop");
	expect(capture.bodies).toHaveLength(1);
});
for (const [name, prefix] of [
	["visible text", success.slice(0, 3)],
	[
		"visible reasoning",
		[
			{ type: "response.output_item.added", item: { type: "reasoning", id: "r", summary: [] } },
			{ type: "response.reasoning_summary_text.delta", delta: "Visible" },
		],
	],
	["tool activity", [{ type: "response.web_search_call.in_progress" }]],
	["terminal completion", [success[4]]],
] as const)
	it(`does not replay idle timeout after ${name}`, async () => {
		process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "20";
		const abandoned = hangingResponse([...prefix]);
		const capture = setup([abandoned]);
		expect((await run()).result.stopReason).toBe("error");
		expect(capture.bodies).toHaveLength(1);
		expect(abandoned.body?.locked).toBe(false);
	});
it("cancellation during cleanup prevents reopening without waiting for cancel hooks", async () => {
	process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS = "20";
	const caller = new AbortController();
	const abandoned = new Response(
		new ReadableStream<Uint8Array>({
			cancel() {
				caller.abort();
				return new Promise(() => {});
			},
		}),
	);
	const capture = setup([abandoned]);
	const { result, events } = await run(caller.signal);
	expect(result.stopReason).toBe("aborted");
	expect(capture.bodies).toHaveLength(1);
	expect(abandoned.body?.locked).toBe(false);
	expect(events.filter(e => e.type === "error")).toHaveLength(1);
});

for (const interruptionKind of ["socket", "eof"] as const)
	it(`continues completed five-child task after ${interruptionKind} interruption with exact native history`, async () => {
		const assignments = [1, 2, 3, 4, 5];
		const argumentsText = '{ "assignments" : [1,2,3,4,5] }';
		const call = {
			type: "function_call",
			id: "task-item",
			call_id: "task-call",
			name: "task",
			arguments: argumentsText,
		};
		const prefix = Array.from({ length: 6 }, (_, i) => [
			{
				type: "response.output_item.added",
				output_index: i,
				item: { type: "reasoning", id: `reason-${i}`, summary: [] },
			},
			{
				type: "response.output_item.done",
				output_index: i,
				item: { type: "reasoning", id: `reason-${i}`, summary: [], encrypted_content: `synthetic-encrypted-${i}` },
			},
		]).flat();
		const capture = setup([
			response(
				[
					...prefix,
					{ type: "response.output_item.added", output_index: 6, item: { ...call, arguments: "" } },
					{ type: "response.output_item.done", output_index: 6, item: call },
					{ type: "response.output_item.done", output_index: 6, item: call },
					{
						type: "response.output_item.added",
						output_index: 7,
						item: {
							type: "function_call",
							id: "unfinished",
							call_id: "unfinished-call",
							name: "task",
							arguments: "",
						},
					},
					{ type: "response.function_call_arguments.delta", output_index: 7, delta: argumentsText },
					{ type: "response.function_call_arguments.done", output_index: 7, arguments: argumentsText },
				],
				interruptionKind === "eof" ? undefined : new Error(socketMessage),
			),
			response(success),
		]);
		const children: number[] = [];
		const checkpointCalls: number[] = [];
		const loop = agentLoop(
			context.messages,
			{
				systemPrompt: "Synthetic test",
				messages: [],
				tools: [
					{
						name: "task",
						label: "Synthetic task",
						description: "Start synthetic children",
						parameters: Type.Object({ assignments: Type.Array(Type.Number()) }),
						async execute(_id, args: { assignments: number[] }) {
							expect(checkpointCalls).toContain(7);
							children.push(...args.assignments);
							return { content: [{ type: "text", text: "Five synthetic children complete" }], details: {} };
						},
					},
				],
			},
			{
				model,
				apiKey: token,
				preferWebsockets: false,
				convertToLlm: messages => messages as import("../src/types").Message[],
				onAssistantCheckpoint: async message => {
					checkpointCalls.push(message.content.length);
				},
			},
			undefined,
			(selected, ctx, options) =>
				streamOpenAICodexResponses(selected as Model<"openai-codex-responses">, ctx, options ?? {}),
		);
		const events = [];
		for await (const event of loop) events.push(event);
		const messages = await loop.result();
		expect(children).toEqual(assignments);
		expect(events.filter(e => e.type === "tool_execution_start")).toHaveLength(1);
		expect(events.filter(e => e.type === "agent_end")).toHaveLength(1);
		expect(messages.filter(m => m.role === "toolResult")).toHaveLength(1);
		expect(messages.at(-1)).toMatchObject({ stopReason: "stop" });
		const continuation = JSON.parse(capture.bodies[1]);
		expect(continuation.input.filter((i: { type: string }) => i.type === "reasoning")).toHaveLength(6);
		expect(continuation.input.find((i: { type: string }) => i.type === "function_call").arguments).toBe(
			argumentsText,
		);
		expect(JSON.stringify(continuation)).not.toContain("unfinished");
		expect(continuation.input.filter((i: { type: string }) => i.type === "function_call_output")).toHaveLength(1);
	});

it("reports typed exhausted interruptions and honors remaining allowance", async () => {
	const capture = setup([response([], new Error(socketMessage)), response([], new Error(socketMessage))]);
	const stream = streamOpenAICodexResponses(model, context, { apiKey: token, maxRetries: 1 });
	for await (const _event of stream) {
		/* drain */
	}
	expect((await stream.result()).interruption).toEqual({
		transport: "sse",
		classification: "socket_closed",
		providerRetriesConsumed: 1,
		completedContentIndices: [],
	});
	expect(capture.bodies).toHaveLength(2);
});

it("reconstructs proxy interruptions with native history and remaining allowance", async () => {
	const native = {
		type: "openaiResponsesHistory" as const,
		provider: model.provider,
		dt: true,
		items: [
			{
				type: "function_call",
				id: "proxy-item",
				call_id: "proxy-call",
				name: "synthetic",
				arguments: '{ "value" : 1 }',
			},
		],
	};
	const call = { type: "toolCall" as const, id: "proxy-call|proxy-item", name: "synthetic", arguments: { value: 1 } };
	const interruption = {
		transport: "sse" as const,
		classification: "socket_closed" as const,
		providerRetriesConsumed: 1,
		completedContentIndices: [0],
	};
	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const capture = setup([
		response([
			{ type: "start" },
			{ type: "toolcall_start", contentIndex: 0, id: call.id, toolName: call.name },
			{ type: "toolcall_end", contentIndex: 0, toolCall: call, providerPayload: native },
			{ type: "error", reason: "error", errorMessage: socketMessage, usage, interruption, providerPayload: native },
		]),
	]);
	const proxy = streamProxy(model, context, {
		proxyUrl: "https://proxy.example.invalid",
		authToken: "synthetic",
		maxRetries: 1,
	});
	const events = [];
	for await (const event of proxy) events.push(event);
	const result = await proxy.result();
	expect(result.interruption).toEqual(interruption);
	expect(result.providerPayload).toEqual(native);
	expect(result.content).toEqual([call]);
	expect(JSON.parse(capture.bodies[0]).options.maxRetries).toBe(1);
	expect(events.filter(e => e.type === "toolcall_end")).toHaveLength(1);
});
