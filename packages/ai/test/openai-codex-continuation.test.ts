import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
	getOpenAICodexTransportDetails,
	streamOpenAICodexResponses,
} from "@f5-sales-demo/pi-ai/providers/openai-codex-responses";
import type { Context, Model, ProviderSessionState } from "@f5-sales-demo/pi-ai/types";
import { getAgentDir, setAgentDir, TempDir } from "@f5-sales-demo/pi-utils";

import { applyCodexInteractionMetadata } from "../src/codex-model-interaction";

type Frame = Record<string, any>;
const originalSocket = global.WebSocket;
const originalFetch = global.fetch;
const originalDir = getAgentDir();
const model: Model<"openai-codex-responses"> = applyCodexInteractionMetadata({
	id: "gpt-6.1-sol",
	name: "Test",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	preferWebsockets: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 272000,
	maxTokens: 128000,
	compat: { supportsCachedReasoningUpdates: true },
});
function token(account = "example-account", suffix = "bbb"): string {
	return `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toBase64()}.${suffix}`;
}
class Socket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 3;
	static instances: Socket[] = [];
	static sent: Frame[] = [];
	static onSend: (frame: Frame, socket: Socket) => void;
	readyState = 0;
	listeners = new Map<string, (event: any) => void>();
	responseHeaders = {
		"x-codex-turn-state": "test-turn",
		"x-models-etag": "test-etag",
		"x-reasoning-included": "true",
	};
	constructor(
		_url: string,
		readonly options: { headers: Record<string, string> },
	) {
		Socket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.listeners.get("open")?.(new Event("open"));
		});
	}
	addEventListener(name: string, callback: (event: any) => void): void {
		this.listeners.set(name, callback);
	}
	send(data: string): void {
		const frame = JSON.parse(data);
		Socket.sent.push(frame);
		Socket.onSend(frame, this);
	}
	close(): void {
		this.readyState = 3;
	}
	lose(): void {
		this.close();
		this.listeners.get("close")?.({ code: 1006 });
	}
	emit(...frames: Frame[]): void {
		queueMicrotask(() => {
			for (const frame of frames) this.listeners.get("message")?.({ data: JSON.stringify(frame) });
		});
	}
}
function complete(socket: Socket, id = "resp_test"): void {
	socket.emit(
		{ type: "response.created", response: { id } },
		{ type: "response.completed", response: { id, status: "completed", output: [] } },
	);
}
let state: Map<string, ProviderSessionState>;
let context: Context;
beforeEach(() => {
	setAgentDir(TempDir.createSync("@pi-continuation-").path());
	Socket.instances = [];
	Socket.sent = [];
	Socket.onSend = (_frame, socket) => complete(socket);
	global.WebSocket = Socket as unknown as typeof WebSocket;
	global.fetch = vi.fn(() => {
		throw new Error("Unexpected SSE request");
	}) as unknown as typeof fetch;
	state = new Map();
	context = {
		systemPrompt: "Test instructions",
		messages: [{ role: "user", content: "Ask questions", timestamp: 1 }],
	};
});
afterEach(() => {
	for (const value of state.values()) value.close?.();
	global.WebSocket = originalSocket;
	global.fetch = originalFetch;
	setAgentDir(originalDir);
	vi.restoreAllMocks();
});
function turn(extra: Record<string, any> = {}, selectedModel = model) {
	return streamOpenAICodexResponses(selectedModel, context, {
		apiKey: token(),
		sessionId: "continuation-test",
		providerSessionState: state,
		reasoning: "low",
		...extra,
	});
}
async function seed(): Promise<void> {
	expect((await turn().result()).stopReason).toBe("stop");
	context.messages.push({ role: "user", content: "Answer: blue", timestamp: 2 });
}
const rejected = {
	type: "error",
	error: {
		type: "invalid_request_error",
		code: "invalid_request_error",
		param: "previous_response_id",
		message: "Invalid previous_response_id",
	},
};

describe("Codex continuation recovery", () => {
	it("sends full context after idle socket closure and discards stale metadata and late frames", async () => {
		await seed();
		const old = Socket.instances[0];
		old.lose();
		old.emit({ type: "response.completed", response: { id: "resp_late", status: "completed" } });
		expect((await turn().result()).stopReason).toBe("stop");
		expect(Socket.sent[1].previous_response_id).toBeUndefined();
		expect(Socket.sent[1].input).toHaveLength(3);
		expect(Socket.instances[1].options.headers["x-codex-turn-state"]).toBeUndefined();
		expect(Socket.instances[1].options.headers["x-models-etag"]).toBeUndefined();
	});
	for (const error of [
		rejected,
		{ type: "error", code: "invalid_request_error", param: "previous_response_id", message: "Invalid parameter" },
		{ type: "error", code: "invalid_request_error", message: "The previous_response_id is invalid" },
		{ type: "error", error: { code: "previous_response_not_found", message: "Missing response" } },
		{
			type: "response.failed",
			response: { error: { code: "previous_response_not_found", message: "Missing response" } },
		},
	]) {
		it(`recovers ${JSON.stringify(error)} once and resumes normal chaining`, async () => {
			await seed();
			Socket.onSend = (_frame, socket) =>
				Socket.sent.length === 2 ? socket.emit(error) : complete(socket, "resp_recovered");
			const events = [];
			for await (const event of turn()) events.push(event.type);
			expect(events.filter(type => type === "done")).toHaveLength(1);
			expect(events).not.toContain("error");
			expect(Socket.sent[1].previous_response_id).toBe("resp_test");
			expect(Socket.instances).toHaveLength(2);
			expect(Socket.sent).toHaveLength(3);
			expect(Socket.sent[2].previous_response_id).toBeUndefined();
			expect(Socket.sent[2].input).toHaveLength(3);
			context.messages.push({ role: "user", content: "Next", timestamp: 3 });
			await turn().result();
			expect(Socket.sent[3].previous_response_id).toBe("resp_recovered");
			expect(Socket.sent[3].input).toHaveLength(1);
		});
	}
	it("surfaces a second rejection and leaves state cleared", async () => {
		await seed();
		Socket.onSend = (_frame, socket) => socket.emit(rejected);
		expect((await turn().result()).stopReason).toBe("error");
		expect(Socket.sent).toHaveLength(3);
		expect(
			getOpenAICodexTransportDetails(model, { sessionId: "continuation-test", providerSessionState: state })
				.canAppend,
		).toBe(false);
	});
	for (const error of [
		{ type: "error", code: "invalid_request_error", param: "tools", message: "Invalid tools; retry your request" },
		{ type: "error", code: "invalid_request_error", message: "Invalid request" },
		{
			type: "error",
			code: "invalid_request_error",
			param: "tools",
			metadata: "previous_response_id",
			message: "Invalid tools",
		},
	])
		it("does not retry unrelated invalid requests", async () => {
			await seed();
			Socket.onSend = (_frame, socket) => socket.emit(error);
			expect((await turn().result()).stopReason).toBe("error");
			expect(Socket.sent).toHaveLength(2);
		});
	it("does not retry a missing response without an internally generated continuation", async () => {
		Socket.onSend = (_frame, socket) => socket.emit(rejected);
		expect((await turn().result()).stopReason).toBe("error");
		expect(Socket.sent).toHaveLength(1);
	});
	it("does not recover cancellation", async () => {
		await seed();
		const controller = new AbortController();
		Socket.onSend = (_frame, socket) => {
			socket.emit(rejected);
			controller.abort();
		};
		expect((await turn({ signal: controller.signal }).result()).stopReason).toBe("aborted");
		expect(Socket.sent).toHaveLength(2);
	});
	for (const frames of [
		[{ type: "response.created", response: { id: "resp_accepted" } }],
		[
			{
				type: "response.output_item.added",
				item: { type: "message", id: "msg_test", role: "assistant", content: [] },
			},
			{ type: "response.output_text.delta", delta: "Partial" },
		],
		[
			{
				type: "response.output_item.done",
				item: { type: "function_call", id: "fc_test", call_id: "call_test", name: "read", arguments: "{}" },
			},
		],
	])
		it("does not replay after response acceptance or output", async () => {
			await seed();
			Socket.onSend = (_frame, socket) => socket.emit(...frames, rejected);
			expect((await turn().result()).stopReason).toBe("error");
			expect(Socket.sent).toHaveLength(2);
		});
	for (const options of [{ apiKey: token("example-account", "new") }, { apiKey: token("example-other-account") }]) {
		it("isolates changed tokens and accounts", async () => {
			await seed();
			await turn(options).result();
			expect(Socket.sent[1].previous_response_id).toBeUndefined();
			expect(Socket.sent[1].input).toHaveLength(3);
		});
	}
	it("isolates models", async () => {
		await seed();
		await turn({}, { ...model, id: "gpt-6-sol" }).result();
		expect(Socket.sent[1].previous_response_id).toBeUndefined();
	});
	it("recovers with current reasoning and full answers, correlated tools and encrypted reasoning exactly once", async () => {
		const reasoning = { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "encrypted-test" };
		const call = { type: "function_call", id: "fc_test", call_id: "call_test", name: "read", arguments: "{}" };
		Socket.onSend = (_frame, socket) =>
			socket.emit(
				{ type: "response.output_item.added", item: reasoning },
				{ type: "response.output_item.done", item: reasoning },
				{ type: "response.output_item.added", item: call },
				{ type: "response.output_item.done", item: call },
				{
					type: "response.completed",
					response: { id: "resp_tools", status: "completed", output: [reasoning, call] },
				},
			);
		const first = await turn().result();
		context.messages.push(
			first,
			{
				role: "toolResult",
				toolCallId: "call_test|fc_test",
				toolName: "read",
				content: [{ type: "text", text: "file-result" }],
				isError: false,
				timestamp: 2,
			},
			{ role: "user", content: "Answer: blue", timestamp: 3 },
		);
		let snapshot: Frame | undefined;
		Socket.onSend = (_frame, socket) => (Socket.sent.length === 2 ? socket.emit(rejected) : complete(socket));
		expect(
			(
				await turn({
					reasoning: "high",
					onPayload: (body: Frame) => {
						snapshot = structuredClone(body);
					},
				}).result()
			).stopReason,
		).toBe("stop");
		expect(Socket.sent[1].previous_response_id).toBe("resp_tools");
		expect(Socket.sent[2]).toEqual({ type: "response.create", ...snapshot });
		expect(Socket.sent[2].reasoning.effort).toBe("high");
		const input = Socket.sent[2].input;
		expect(input.filter((item: Frame) => item.type === "function_call")).toHaveLength(1);
		expect(input.filter((item: Frame) => item.type === "function_call_output")).toEqual([
			{ type: "function_call_output", call_id: "call_test", output: "file-result" },
		]);
		expect(input.filter((item: Frame) => item.type === "reasoning")[0].encrypted_content).toBe("encrypted-test");
		expect(JSON.stringify(input).split("Answer: blue")).toHaveLength(2);
	});
	it("uses current reasoning after idle closure rather than cached configuration updates", async () => {
		await seed();
		Socket.instances[0].lose();
		await turn({ reasoning: "high" }).result();
		expect(Socket.sent[1].reasoning.effort).toBe("high");
		expect(Socket.sent[1].input.some((item: Frame) => item.type === "configuration_update")).toBe(false);
	});
	it("uses full context for SSE when the recovery handshake fails", async () => {
		await seed();
		let sseBody: Frame | undefined;
		global.fetch = vi.fn(async (_url, init) => {
			sseBody = JSON.parse(String(init?.body));
			return new Response(
				`data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_sse", status: "completed" } })}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		}) as unknown as typeof fetch;
		class ErrorOnlySocket {
			static OPEN = 1;
			static CONNECTING = 0;
			readyState = 0;
			constructor() {
				queueMicrotask(() => this.error?.({ type: "error", message: "failed handshake" }));
			}
			error?: (event: any) => void;
			addEventListener(name: string, callback: (event: any) => void) {
				if (name === "error") this.error = callback;
			}
			close() {
				this.readyState = 3;
			}
		}
		Socket.onSend = (_frame, socket) => {
			socket.emit(rejected);
			global.WebSocket = ErrorOnlySocket as unknown as typeof WebSocket;
		};
		expect((await turn({ reasoning: "high" }).result()).stopReason).toBe("stop");
		expect(sseBody?.previous_response_id).toBeUndefined();
		expect(sseBody?.input).toHaveLength(3);
		expect(sseBody?.reasoning.effort).toBe("high");
	});
	it("does not replay a failed response carrying an accepted response id", async () => {
		await seed();
		Socket.onSend = (_frame, socket) =>
			socket.emit({
				type: "response.failed",
				response: {
					id: "resp_accepted",
					error: { code: "previous_response_not_found", message: "Missing response" },
				},
			});
		expect((await turn().result()).stopReason).toBe("error");
		expect(Socket.sent).toHaveLength(2);
	});
});
