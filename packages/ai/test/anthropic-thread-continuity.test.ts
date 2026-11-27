import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Context, Model, ProviderSessionState } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-5-5",
	name: "Sonnet 5.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
};

function install() {
	const bodies: any[] = [];
	let turn = 0;
	vi.spyOn(Messages.prototype, "create").mockImplementation((body: any) => {
		bodies.push(structuredClone(body));
		turn++;
		const events = [
			{
				type: "message_start",
				message: { id: `msg_${turn}`, model: model.id, usage: { input_tokens: 1, output_tokens: 0 } },
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Remembered." } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
			{ type: "message_stop" },
		];
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
		} as never;
	});
	return bodies;
}

afterEach(() => vi.restoreAllMocks());

describe("Anthropic thread continuity", () => {
	it("creates once, then sends only appended messages while retaining the preceding reply", async () => {
		const bodies = install();
		const state = new Map<string, ProviderSessionState>();
		const options = {
			apiKey: "test-key",
			sessionId: "thread-canary",
			messageThreads: true,
			providerSessionState: state,
		};
		const context: Context = {
			systemPrompt: "Remember the canary.",
			messages: [{ role: "user", content: "Canary: mango-47", timestamp: 1 }],
		};
		const first = await streamAnthropic(model, context, options).result();
		expect(first.stopReason).toBe("stop");
		context.messages.push(first, { role: "user", content: "What was the canary?", timestamp: 2 });
		const second = await streamAnthropic(model, context, options).result();
		expect(second.stopReason).toBe("stop");
		expect(bodies[0].thread).toEqual({ type: "create" });
		expect(bodies[1].thread).toEqual({ type: "continue", previous_message_id: "msg_1" });
		expect(bodies[1].messages).toHaveLength(1);
		expect(JSON.stringify(bodies[1].messages)).not.toContain("mango-47");
		expect(bodies[1].system).toBeUndefined();
		expect(bodies[1].tools).toBeUndefined();
	});

	it("starts a new full thread when prior history or fixed settings change", async () => {
		const bodies = install();
		const state = new Map<string, ProviderSessionState>();
		const options = {
			apiKey: "test-key",
			sessionId: "changed-thread",
			messageThreads: true,
			providerSessionState: state,
		};
		const context: Context = { messages: [{ role: "user", content: "before", timestamp: 1 }] };
		const first = await streamAnthropic(model, context, options).result();
		context.messages.push(first, { role: "user", content: "next", timestamp: 2 });
		context.systemPrompt = "New fixed system instruction.";
		await streamAnthropic(model, context, options).result();
		expect(bodies[1].thread).toEqual({ type: "create" });
		expect(bodies[1].messages).toHaveLength(3);
	});

	it("does not use implicit threads on an unqualified gateway", async () => {
		const bodies = install();
		await streamAnthropic(
			{ ...model, baseUrl: "https://example.invalid/anthropic" },
			{ messages: [{ role: "user", content: "hello", timestamp: 1 }] },
			{ apiKey: "test-key", sessionId: "gateway" },
		).result();
		expect(bodies[0].thread).toBeUndefined();
	});

	it("releasing provider session state prevents continuation of a stale thread", async () => {
		const bodies = install();
		const state = new Map<string, ProviderSessionState>();
		const options = {
			apiKey: "test-key",
			sessionId: "released-thread",
			messageThreads: true,
			providerSessionState: state,
		};
		const context: Context = { messages: [{ role: "user", content: "hello", timestamp: 1 }] };
		const first = await streamAnthropic(model, context, options).result();
		for (const resource of state.values()) resource.close();
		context.messages.push(first, { role: "user", content: "next", timestamp: 2 });
		await streamAnthropic(model, context, options).result();
		expect(bodies[1].thread).toEqual({ type: "create" });
	});
});

it("continues OAuth threads despite changing generated billing and request metadata", async () => {
	const bodies = install();
	const state = new Map<string, ProviderSessionState>();
	const options = {
		apiKey: "synthetic-oauth",
		isOAuth: true,
		sessionId: "oauth-telemetry",
		messageThreads: true,
		providerSessionState: state,
	};
	const context: Context = {
		systemPrompt: "Preserve user instructions",
		messages: [{ role: "user", content: "Remember the synthetic canary", timestamp: 1 }],
	};
	const first = await streamAnthropic(model, context, options).result();
	context.messages.push(first, { role: "user", content: "Continue", timestamp: 2 });
	const second = await streamAnthropic(model, context, options).result();
	expect(second.stopReason).toBe("stop");
	expect(bodies[0].metadata.user_id).not.toBe(bodies[1].metadata.user_id);
	expect(bodies[1].thread).toEqual({ type: "continue", previous_message_id: "msg_1" });
	expect(bodies[1].messages).toHaveLength(1);
	expect(bodies[1].system).toBeUndefined();
});
it("keeps caller-owned identity metadata in the thread binding", async () => {
	const bodies = install();
	const state = new Map<string, ProviderSessionState>();
	const options = { apiKey: "test", sessionId: "caller-identity", messageThreads: true, providerSessionState: state };
	const context = structuredClone({ messages: [{ role: "user", content: "before", timestamp: 1 }] } as Context);
	const first = await streamAnthropic(model, context, { ...options, metadata: { user_id: "caller-one" } }).result();
	context.messages.push(first, { role: "user", content: "next", timestamp: 2 });
	await streamAnthropic(model, context, { ...options, metadata: { user_id: "caller-two" } }).result();
	expect(bodies[1].thread).toEqual({ type: "create" });
});
it("does not ignore a caller's changed billing-like system text", async () => {
	const bodies = install();
	const state = new Map<string, ProviderSessionState>();
	const options = {
		apiKey: "test",
		isOAuth: true,
		sessionId: "caller-system",
		messageThreads: true,
		providerSessionState: state,
	};
	const context: Context = {
		systemPrompt: "x-anthropic-billing-header: caller-owned rule one",
		messages: [{ role: "user", content: "before", timestamp: 1 }],
	};
	const first = await streamAnthropic(model, context, options).result();
	context.messages.push(first, { role: "user", content: "next", timestamp: 2 });
	context.systemPrompt = "x-anthropic-billing-header: caller-owned rule two";
	await streamAnthropic(model, context, options).result();
	expect(bodies[1].thread).toEqual({ type: "create" });
});
