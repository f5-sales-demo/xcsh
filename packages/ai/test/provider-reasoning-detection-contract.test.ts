import { describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { detectCompat } from "../src/providers/openai-completions";
import type { Model } from "../src/types";

describe("provider completion compatibility detection", () => {
	it("detects direct DeepSeek, Together, Ant Ling and Baseten protocol constraints", () => {
		for (const [provider, baseUrl, thinkingFormat] of [
			["deepseek", "https://api.deepseek.com", "deepseek"],
			["together", "https://api.together.xyz/v1", "together"],
			["ant-ling", "https://api.ant-ling.com/v1", "ant-ling"],
			["baseten", "https://inference.baseten.co/v1", "openai"],
		]) {
			const model = {
				...getBundledModel("openai", "gpt-4o-mini"),
				api: "openai-completions",
				provider,
				baseUrl,
				id: "synthetic",
			} as Model<"openai-completions">;
			expect(detectCompat(model)).toMatchObject({
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				maxTokensField: "max_tokens",
				thinkingFormat,
			});
		}
	});
});
