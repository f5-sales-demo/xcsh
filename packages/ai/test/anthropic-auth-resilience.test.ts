import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import type { AuthCredentialStore } from "../src/auth-storage";
import { type AnthropicAuthEnvironment, findAnthropicAuth } from "../src/utils/anthropic-auth";

async function withEnv(
	overrides: AnthropicAuthEnvironment,
	fn: (environment: AnthropicAuthEnvironment) => void | Promise<void>,
): Promise<void> {
	await fn(overrides);
}

const brokenStore = {
	listAuthCredentials: () => {
		throw new Error("DB corrupted");
	},
	close: () => {},
} as unknown as AuthCredentialStore;

const missingModelsYmlPath = path.join(os.tmpdir(), `pi-anthropic-resilience-missing-${process.pid}.yml`);

describe("findAnthropicAuth resilience", () => {
	it("falls back to ANTHROPIC_API_KEY when AuthCredentialStore.open throws", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: "sk-ant-fallback-key",
				ANTHROPIC_BASE_URL: "https://api.anthropic.com",
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
			},
			async environment => {
				const auth = await findAnthropicAuth({
					store: brokenStore,
					environment,
					modelsYmlPath: missingModelsYmlPath,
				});
				expect(auth).not.toBeNull();
				expect(auth?.apiKey).toBe("sk-ant-fallback-key");
				expect(auth?.baseUrl).toBe("https://api.anthropic.com");
			},
		);
	});

	it("falls back to litellm credentials when AuthCredentialStore.open throws and no ANTHROPIC_API_KEY", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://litellm.example.com",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth({
					store: brokenStore,
					environment,
					modelsYmlPath: missingModelsYmlPath,
				});
				expect(auth).not.toBeNull();
				expect(auth?.apiKey).toBe("sk-litellm-test-key");
				expect(auth?.baseUrl).toBe("https://litellm.example.com/anthropic");
			},
		);
	});

	it("re-throws store error when no later auth tier can succeed", async () => {
		// If the DB is the only possible auth source and it fails, the error
		// should be surfaced so the user knows why auth isn't working.
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: undefined,
				LITELLM_API_KEY: undefined,
			},
			async environment => {
				await expect(
					findAnthropicAuth({ store: brokenStore, environment, modelsYmlPath: missingModelsYmlPath }),
				).rejects.toThrow("DB corrupted");
			},
		);
	});
});
