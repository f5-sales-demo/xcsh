import { expect, test } from "bun:test";
import { routingConfig } from "../scripts/container/import-native";

test("imports routes and roles while replacing executable or literal credentials", () => {
	const original = {
		configVersion: 12,
		providers: {
			litellm: {
				apiKey: "!security find-generic-password",
				api: "openai-completions",
				discovery: { type: "openai-compat" },
				models: [
					{
						id: "gpt-6.1-sol",
						api: "openai-responses",
						apiKey: "fixture-nested-key",
						baseUrl: "https://gateway.invalid/openai/v1",
					},
				],
			},
			anthropic: {
				apiKey: "fixture-private-key",
				api: "anthropic-messages",
				baseUrl: "https://gateway.invalid/anthropic",
			},
		},
	};
	const config = {
		modelRoles: { default: "litellm/gpt-6.1-sol:medium" },
		browser: { headless: false },
		memories: { private: true },
	};
	const result = routingConfig(original, config);
	expect(JSON.stringify(result)).not.toContain("security find");
	expect(JSON.stringify(result)).not.toContain("fixture-private-key");
	expect(result.models.providers.litellm.apiKey).toBe("LITELLM_API_KEY");
	expect((result.models.providers.litellm.models as Array<{ api: string }>)[0].api).toBe("openai-responses");
	expect(JSON.stringify(result)).not.toContain("fixture-nested-key");
	expect(result.settings.modelRoles).toEqual(config.modelRoles);
	expect(result.settings.browser).toEqual({ headless: true });
	expect(result.settings.memories).toBeUndefined();
	expect(original.providers.anthropic.apiKey).toBe("fixture-private-key");
});
