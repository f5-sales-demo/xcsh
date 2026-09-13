import { expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { getBundledModel } from "../src/models";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Context, Model } from "../src/types";

const context: Context = {
	messages: [{ role: "user", content: "Update one field", timestamp: 0 }],
	tools: [
		{
			name: "person_patch",
			description: "Partial person facts",
			strict: false,
			parameters: Type.Object(
				{
					facts: Type.Partial(
						Type.Object({ jobTitle: Type.String(), givenName: Type.String() }, { additionalProperties: false }),
					),
				},
				{ additionalProperties: false },
			),
		},
	],
};
test.each(["openai-responses", "openai-codex-responses"] as const)(
	"%s preserves explicit non-strict partial fields",
	async api => {
		const base = getBundledModel("openai", "gpt-5-mini");
		if (!base) throw new Error("Missing fixture model");
		let payload: unknown;
		const signal = AbortSignal.abort();
		if (api === "openai-responses")
			await streamOpenAIResponses({ ...base, api } as Model<"openai-responses">, context, {
				apiKey: "test-key",
				signal,
				onPayload: p => {
					payload = p;
				},
			}).result();
		else {
			const token = `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } })).toString("base64")}.bbb`;
			await streamOpenAICodexResponses(
				{ ...base, api, provider: "openai-codex" } as Model<"openai-codex-responses">,
				context,
				{
					apiKey: token,
					signal,
					onPayload: p => {
						payload = p;
					},
				},
			).result();
		}
		const tools = (
			payload as { tools?: { strict?: boolean; parameters: { properties: { facts: { required?: string[] } } } }[] }
		)?.tools;
		expect(tools?.[0]?.strict).toBe(false);
		expect(tools?.[0]?.parameters.properties.facts.required).toBeUndefined();
	},
);
