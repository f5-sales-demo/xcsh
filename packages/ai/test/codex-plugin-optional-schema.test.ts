import { afterEach, describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { applyCodexInteractionMetadata } from "../src/codex-model-interaction";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses";
import type { Model, Tool } from "../src/types";
import { validateToolArguments } from "../src/utils/validation";

const model: Model<"openai-codex-responses"> = applyCodexInteractionMetadata({
	id: "gpt-6-astra",
	name: "Example",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 272000,
	maxTokens: 4096,
});

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

async function captureTool(tool: Tool) {
	let payload: Record<string, any> | undefined;
	globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
		payload = JSON.parse(String(init?.body));
		return new Response(
			`data: ${JSON.stringify({
				type: "response.completed",
				response: {
					id: "example-plugin-schema",
					model: "gpt-6-astra",
					status: "completed",
					output: [],
					usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
				},
			})}\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		);
	}) as typeof fetch;
	const tokenBody = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth": {
				chatgpt_account_id: "example-account",
			},
		}),
	).toString("base64url");
	const result = await streamOpenAICodexResponses(
		model,
		{ messages: [{ role: "user", content: "Discover without hints", timestamp: 1 }], tools: [tool] },
		{ apiKey: `example.${tokenBody}.example`, preferWebsockets: false, maxRetries: 0 },
	).result();
	expect(result.stopReason).toBe("stop");
	expect(payload).toBeDefined();
	return payload!.tools[0];
}

function pluginTool(strict?: boolean): Tool {
	return {
		name: "discover_example_compute",
		description: "Discover current catalog without optional hints",
		parameters: Type.Object({
			subscriptionId: Type.String(),
			publisher: Type.Optional(Type.String()),
			vmSize: Type.Optional(Type.String()),
		}),
		...(strict === undefined ? {} : { strict }),
	};
}

describe("Codex plugin optional tool schema", () => {
	it("sends unannotated plugin optional fields as nullable in explicit strict mode", async () => {
		const tool = pluginTool();
		const sent = await captureTool(tool);
		expect(sent.strict).toBe(true);
		expect(sent.parameters.required).toEqual(["subscriptionId", "publisher", "vmSize"]);
		for (const key of ["publisher", "vmSize"]) {
			expect(sent.parameters.properties[key].anyOf).toContainEqual({ type: "null" });
		}
		expect(tool.parameters.required).toEqual(["subscriptionId"]);
		expect(
			validateToolArguments(tool, {
				type: "toolCall",
				id: "example-call",
				name: tool.name,
				arguments: { subscriptionId: "example-subscription", publisher: null, vmSize: null },
			}),
		).toEqual({ subscriptionId: "example-subscription" });
	});
	it("honors a plugin's explicit non-strict choice", async () => {
		const sent = await captureTool(pluginTool(false));
		expect(sent.strict).toBe(false);
		expect(sent.parameters.required).toEqual(["subscriptionId"]);
		expect(sent.parameters.properties.publisher).toEqual({ type: "string" });
	});
	it("keeps explicit strict plugins nullable", async () => {
		const sent = await captureTool(pluginTool(true));
		expect(sent.strict).toBe(true);
		expect(sent.parameters.properties.publisher.anyOf).toContainEqual({ type: "null" });
	});
	it("explicitly opts out when a plugin's dynamic map cannot be strict", async () => {
		const sent = await captureTool({
			name: "example_map",
			description: "Read dynamic map",
			parameters: Type.Object({ labels: Type.Record(Type.String(), Type.String()) }),
		});
		expect(sent.strict).toBe(false);
	});
});
