import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { Effort, enrichModelThinking } from "../src/model-thinking";
import { getBundledModel } from "../src/models";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import { mapOptionsForApi, streamSimple } from "../src/stream";
import type { Model, OpenAICompat } from "../src/types";

function modelWith(compat: Record<string, unknown>): Model<"openai-completions"> {
	return {
		...getBundledModel("openai", "gpt-4o-mini"),
		id: "synthetic-reasoning",
		api: "openai-completions",
		provider: "synthetic-test",
		reasoning: true,
		maxTokens: 2000,
		thinking: {
			mode: "effort",
			defaultLevel: "high",
			supportedLevels: [
				{ effort: "high", description: "High" },
				{ effort: "max", description: "Max" },
			],
		},
		compat: compat as OpenAICompat,
	};
}
async function capture(compat: Record<string, unknown>, reasoning?: "high" | "max") {
	let payload: any;
	await streamOpenAICompletions(
		modelWith(compat),
		{ messages: [] },
		{
			apiKey: "synthetic",
			reasoning: reasoning as "high",
			signal: AbortSignal.abort(),
			onPayload: value => {
				payload = value;
			},
		},
	).result();
	return payload;
}
describe("upstream completion control contracts", () => {
	it("resolves configured templates and leaves answer room in the reasoning budget", async () => {
		const payload = await capture(
			{
				thinkingFormat: "chat-template",
				thinkingTokenBudgetField: "thinking_budget_tokens",
				chatTemplateKwargs: {
					enabled: { $var: "thinking.enabled" },
					effort: { $var: "thinking.effort" },
					budget: { $var: "thinking.budget" },
					omitted: { $var: "thinking.effort", omitWhenOff: true },
					literal: "synthetic",
				},
			},
			"high",
		);
		expect(payload.chat_template_kwargs).toMatchObject({ enabled: true, effort: "high", literal: "synthetic" });
		expect(payload.thinking_budget_tokens).toBeGreaterThan(0);
		expect(payload.thinking_budget_tokens).toBeLessThan(2000);
		expect(payload.chat_template_kwargs.budget).toBe(payload.thinking_budget_tokens);
		const off = await capture({
			thinkingFormat: "chat-template",
			chatTemplateKwargs: {
				enabled: { $var: "thinking.enabled" },
				omitted: { $var: "thinking.effort", omitWhenOff: true },
			},
		});
		expect(off.chat_template_kwargs).toEqual({ enabled: false });
	});
	it("emits Baseten, DeepSeek, Together and string thinking controls", async () => {
		expect(
			(
				await capture(
					{ thinkingFormat: "baseten", chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } } },
					"high",
				)
			).chat_template_args,
		).toEqual({ enable_thinking: true });
		expect((await capture({ thinkingFormat: "deepseek", supportsReasoningEffort: false }, "high")).thinking).toEqual({
			type: "enabled",
		});
		expect((await capture({ thinkingFormat: "together" }, "high")).reasoning).toEqual({ enabled: true });
		expect((await capture({ thinkingFormat: "string-thinking" }, "high")).thinking).toBe("high");
		expect((await capture({ thinkingFormat: "qwen-chat-template" }, "high")).chat_template_kwargs).toMatchObject({
			enable_thinking: true,
			preserve_thinking: true,
		});
	});
	it("retains advertised max without converting it to xhigh", () => {
		expect(mapOptionsForApi(modelWith({}), { reasoning: Effort.Max })).toMatchObject({ reasoning: "max" });
	});
	it("enriches Baseten's exact GLM and Kimi contracts", () => {
		for (const id of ["zai-org/GLM-5.2", "moonshotai/Kimi-K2.6"]) {
			const model = enrichModelThinking({ ...modelWith({}), provider: "baseten", id, thinking: undefined });
			expect(model.compat).toMatchObject({
				thinkingFormat: "baseten",
				chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } },
			});
			expect(model.thinking?.supportedLevels.map(level => level.effort)).toEqual(
				id.includes("GLM") ? ["high", "max"] : ["high"],
			);
		}
	});
	it("awaits replacement hooks and resolves Cloudflare account before transport", async () => {
		let url = "";
		let payload: any;
		using _hook = hookFetch(async (input, init) => {
			url = String(input);
			payload = JSON.parse(String(init?.body));
			return new Response(
				'data: {"choices":[{"index":0,"delta":{"content":"synthetic"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		});
		const model = {
			...modelWith({}),
			provider: "cloudflare-workers-ai",
			baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
		};
		const result = await streamSimple(
			model,
			{ messages: [] },
			{
				apiKey: "synthetic",
				accountId: "example-account",
				onPayload: async value => {
					await Promise.resolve();
					return { ...(value as object), user: "replacement" };
				},
			},
		).result();
		expect(result.stopReason).toBe("stop");
		expect(url).toContain("/accounts/example-account/ai/v1/chat/completions");
		expect(payload.user).toBe("replacement");
	});
});
