import { describe, expect, it } from "bun:test";
import type { Model, Usage } from "@f5-sales-demo/pi-ai";
import { ContextProfileCollector, estimateContextTokens, profileProviderPayload } from "../src/context/profile";

const model = {
	id: "profile-model",
	name: "Profile Model",
	provider: "google",
	api: "google-generative-ai",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_048_576,
	maxTokens: 8192,
} as Model;

const usage: Usage = {
	input: 4099,
	output: 5,
	cacheRead: 46_714,
	cacheWrite: 0,
	totalTokens: 50_818,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("privacy-safe context profiling", () => {
	it("attributes provider payload bytes without retaining prompt or message content", () => {
		const secret = "customer-token-super-secret";
		const snapshot = profileProviderPayload(
			{
				systemInstruction: { parts: [{ text: `system ${secret}` }] },
				contents: [{ role: "user", parts: [{ text: `message ${secret}` }] }],
				tools: [{ functionDeclarations: [{ name: "read", description: secret, parameters: { type: "object" } }] }],
			},
			model,
			1,
		);

		expect(snapshot.payloadBytes).toBeGreaterThan(0);
		expect(snapshot.categoryBytes.system_prompt).toBeGreaterThan(0);
		expect(snapshot.categoryBytes.messages).toBeGreaterThan(0);
		expect(snapshot.categoryBytes.tools).toBeGreaterThan(0);
		expect(snapshot.messageCount).toBe(1);
		expect(snapshot.toolCount).toBe(1);
		expect(JSON.stringify(snapshot)).not.toContain(secret);
	});

	it("handles Anthropic and OpenAI payload shapes consistently", () => {
		const anthropic = profileProviderPayload(
			{ system: [{ type: "text", text: "rules" }], messages: [{ role: "user", content: "ping" }], tools: [] },
			{ ...model, provider: "anthropic", api: "anthropic-messages" } as Model,
			1,
		);
		const openai = profileProviderPayload(
			{ instructions: "rules", input: [{ role: "user", content: "ping" }], tools: [] },
			{ ...model, provider: "openai", api: "openai-responses" } as Model,
			1,
		);

		expect(anthropic.messageCount).toBe(1);
		expect(openai.messageCount).toBe(1);
		expect(anthropic.categoryBytes.system_prompt).toBeGreaterThan(0);
		expect(openai.categoryBytes.system_prompt).toBeGreaterThan(0);
	});

	it("attributes tool results separately from ordinary messages", () => {
		const snapshot = profileProviderPayload(
			{
				input: [
					{ role: "user", content: "ping" },
					{ type: "function_call_output", call_id: "call-1", output: "result" },
				],
			},
			{ ...model, provider: "openai", api: "openai-responses" } as Model,
			1,
		);
		expect(snapshot.categoryBytes.messages).toBeGreaterThan(0);
		expect(snapshot.categoryBytes.tool_results).toBeGreaterThan(0);
	});

	it("unwraps Google Cloud Code Assist request envelopes", () => {
		const snapshot = profileProviderPayload(
			{
				project: "safe-project-id",
				request: {
					systemInstruction: { parts: [{ text: "rules" }] },
					contents: [{ role: "user", parts: [{ text: "ping" }] }],
					tools: [{ functionDeclarations: [{ name: "read", parameters: { type: "object" } }] }],
				},
			},
			model,
			1,
		);
		expect(snapshot.categoryBytes.system_prompt).toBeGreaterThan(0);
		expect(snapshot.messageCount).toBe(1);
		expect(snapshot.toolCount).toBe(1);
	});

	it("reconciles provider usage and context-window percentage on the matching call", () => {
		const collector = new ContextProfileCollector("progressive");
		collector.captureProviderPayload({ contents: [{ role: "user", parts: [{ text: "PONG" }] }] }, model);
		collector.recordProviderUsage(model, usage);
		const profile = collector.snapshot();
		const call = profile.providerCalls[0];

		expect(call.providerPromptTokens).toBe(50_813);
		expect(call.providerOutputTokens).toBe(5);
		expect(call.contextWindow).toBe(1_048_576);
		expect(call.windowPercentage).toBeCloseTo((50_813 / 1_048_576) * 100, 8);
	});

	it("uses a deterministic conservative character estimator", () => {
		expect(estimateContextTokens(0)).toBe(0);
		expect(estimateContextTokens(1)).toBe(1);
		expect(estimateContextTokens(400)).toBe(100);
	});
});
