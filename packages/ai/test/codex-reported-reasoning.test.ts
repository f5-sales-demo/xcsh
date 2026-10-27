import { afterEach, expect, test } from "bun:test";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses";
import type { Model } from "../src/types";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const model: Model<"openai-codex-responses"> = {
	id: "gpt-6-astra",
	name: "Fixture",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	thinking: { mode: "effort", defaultLevel: "high", supportedLevels: [{ effort: "high", description: "Fixture" }] },
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 272000,
	maxTokens: 4096,
};
async function response(created: unknown, completed: unknown) {
	const frames = [
		{
			type: "response.created",
			response: {
				id: "example-response",
				model: model.id,
				...(created === undefined ? {} : { reasoning: created }),
			},
		},
		{
			type: "response.completed",
			response: {
				id: "example-response",
				model: model.id,
				status: "completed",
				...(completed === undefined ? {} : { reasoning: completed }),
				output: [],
				usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
			},
		},
	];
	globalThis.fetch = (async () =>
		new Response(frames.map(frame => "data: " + JSON.stringify(frame) + "\n\n").join(""))) as unknown as typeof fetch;
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "example-account" } }),
	).toString("base64url");
	return streamOpenAICodexResponses(
		model,
		{ messages: [{ role: "user", content: "Example", timestamp: 1 }] },
		{ apiKey: "example." + payload + ".example", reasoning: "high", preferWebsockets: false, maxRetries: 0 },
	).result();
}
test.each(["created", "completed"])("retains provider reasoning from %s rather than selected effort", async phase => {
	const result = await response(
		phase === "created" ? { effort: "medium" } : undefined,
		phase === "completed" ? { effort: "medium" } : undefined,
	);
	expect(result.stopReason).toBe("stop");
	expect(result.responseAttribution).toMatchObject({
		requestedModel: model.id,
		responseModel: model.id,
		responseReasoningEffort: "medium",
		responseReasoningEffortSource: "response-body",
	});
});
test("completed provider reasoning supersedes created reasoning", async () => {
	const result = await response({ effort: "medium" }, { effort: "high" });
	expect(result.responseAttribution).toMatchObject({
		responseReasoningEffort: "high",
		responseReasoningEffortSource: "response-body",
	});
});
test.each([undefined, null, {}, { effort: 42 }, { effort: "private-reasoning-content" }])(
	"missing or invalid reasoning %j is not inferred from request",
	async value => {
		const result = await response(value, value);
		expect(result.stopReason).toBe("stop");
		expect(result.responseAttribution).not.toHaveProperty("responseReasoningEffort");
		expect(result.responseAttribution).not.toHaveProperty("responseReasoningEffortSource");
	},
);

test("provider retry discards abandoned reported reasoning", async () => {
	let calls = 0;
	globalThis.fetch = (async () =>
		new Response(
			(++calls === 1
				? [
						{
							type: "response.created",
							response: { id: "abandoned", model: model.id, reasoning: { effort: "medium" } },
						},
						{ type: "error", code: "model_error", message: "Synthetic retryable failure" },
					]
				: [
						{
							type: "response.completed",
							response: {
								id: "final",
								model: model.id,
								status: "completed",
								output: [],
								usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
							},
						},
					]
			)
				.map(frame => "data: " + JSON.stringify(frame) + "\n\n")
				.join(""),
		)) as unknown as typeof fetch;
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "example-account" } }),
	).toString("base64url");
	const result = await streamOpenAICodexResponses(
		model,
		{ messages: [{ role: "user", content: "Example", timestamp: 1 }] },
		{ apiKey: "example." + payload + ".example", reasoning: "high", preferWebsockets: false, maxRetries: 1 },
	).result();
	expect(result.stopReason).toBe("stop");
	expect(calls).toBe(2);
	expect(result.responseAttribution).not.toHaveProperty("responseReasoningEffort");
});
