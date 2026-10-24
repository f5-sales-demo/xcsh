import { expect, it } from "bun:test";
import { buildKiroRequest, streamKiro } from "../src/providers/kiro";
import type { Model } from "../src/types";

const model: Model<"kiro-api"> = {
	id: "kiro/claude-haiku-4.5",
	name: "Haiku",
	provider: "kiro",
	api: "kiro-api",
	baseUrl: "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
	contextWindow: 200000,
	maxTokens: 8192,
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const credential = JSON.stringify({
	access: "fake",
	profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/fake",
	serviceRegion: "us-east-1",
});
function crc(bytes: Uint8Array) {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}
function frame(body: object, type = "assistantResponseEvent") {
	const e = new TextEncoder();
	const key = e.encode(":event-type");
	const value = e.encode(type);
	const payload = e.encode(JSON.stringify(body));
	const headers = new Uint8Array(1 + key.length + 3 + value.length);
	headers[0] = key.length;
	headers.set(key, 1);
	headers[1 + key.length] = 7;
	new DataView(headers.buffer).setUint16(2 + key.length, value.length);
	headers.set(value, 4 + key.length);
	const b = new Uint8Array(16 + headers.length + payload.length);
	const view = new DataView(b.buffer);
	view.setUint32(0, b.length);
	view.setUint32(4, headers.length);
	view.setUint32(8, crc(b.subarray(0, 8)));
	b.set(headers, 12);
	b.set(payload, 12 + headers.length);
	view.setUint32(b.length - 4, crc(b.subarray(0, b.length - 4)));
	return b;
}
function response(frames: Uint8Array[]) {
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const f of frames) for (let i = 0; i < f.length; i += 3) controller.enqueue(f.slice(i, i + 3));
				controller.close();
			},
		}),
		{ headers: { "content-type": "application/vnd.amazon.eventstream" } },
	);
}
it("streams fragmented Unicode, tools and reported usage through xcsh events", async () => {
	const s = streamKiro(
		model,
		{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
		{
			apiKey: credential,
			fetch: async () =>
				response([
					frame({ content: "Hello 🌍" }),
					frame({ name: "read", toolUseId: "one", input: '{"path":' }, "toolUseEvent"),
					frame({ input: '"file"}', stop: true }, "toolUseEvent"),
					frame({ usage: { inputTokens: 12, outputTokens: 7 } }, "metadataEvent"),
				]),
		},
	);
	const events = [];
	for await (const event of s) events.push(event.type);
	const m = await s.result();
	expect(m.stopReason).toBe("toolUse");
	expect(m.content[0]).toEqual({ type: "text", text: "Hello 🌍" });
	expect(m.content[1]).toMatchObject({ type: "toolCall", id: "one", arguments: { path: "file" } });
	expect(m.usage.input).toBe(12);
	expect(m.usage.tokenSource).toBe("reported");
	expect(events).toContain("toolcall_end");
});
it("retains exact service model ID and tool results in continuation", () => {
	const request = buildKiroRequest(
		model,
		{
			systemPrompt: "System",
			messages: [
				{ role: "user", content: "Read file", timestamp: 0 },
				{
					role: "assistant",
					api: "kiro-api",
					provider: "kiro",
					model: model.id,
					content: [{ type: "toolCall", id: "one", name: "read", arguments: { path: "file" } }],
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 0,
				},
				{
					role: "toolResult",
					toolCallId: "one",
					toolName: "read",
					content: [{ type: "text", text: "contents" }],
					isError: false,
					timestamp: 0,
				},
			],
		},
		"profile",
		"conversation",
	);
	expect(request.conversationState.currentMessage.userInputMessage.modelId).toBe(model.id);
	expect(
		request.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults![0],
	).toMatchObject({ toolUseId: "one", status: "success", content: [{ text: "contents" }] });
	expect(request.conversationState.history).toHaveLength(2);
});
it("fails corrupt, incomplete, empty, service-error and malformed tool streams", async () => {
	const corrupt = frame({ content: "x" });
	corrupt[15] ^= 1;
	for (const frames of [
		[corrupt],
		[frame({ content: "x" }).slice(0, -1)],
		[],
		[frame({ message: "private-error" }, "internalServerException")],
		[frame({ name: "read", toolUseId: "one", input: "{broken", stop: true }, "toolUseEvent")],
	]) {
		const result = await streamKiro(
			model,
			{ messages: [] },
			{ apiKey: credential, fetch: async () => response(frames) },
		).result();
		expect(result.stopReason).toBe("error");
	}
});
it("cancels before network and labels estimated tokens", async () => {
	let calls = 0;
	const aborted = await streamKiro(
		model,
		{ messages: [] },
		{
			apiKey: credential,
			signal: AbortSignal.abort(),
			fetch: async () => {
				calls++;
				return response([]);
			},
		},
	).result();
	expect(aborted.stopReason).toBe("aborted");
	expect(calls).toBe(0);
	const m = await streamKiro(
		model,
		{ messages: [] },
		{ apiKey: credential, fetch: async () => response([frame({ content: "hello" })]) },
	).result();
	expect(m.usage.tokenSource).toBe("estimated");
});
it("routes streamSimple used by the actual agent and preserves injected transport", async () => {
	const { streamSimple } = await import("../src/stream");
	const result = await streamSimple(
		model,
		{ messages: [{ role: "user", content: "Hi", timestamp: 0 }] },
		{ apiKey: credential, fetch: async () => response([frame({ content: "agent path" })]) },
	).result();
	expect(result.stopReason).toBe("stop");
	expect(result.content[0]).toEqual({ type: "text", text: "agent path" });
});
