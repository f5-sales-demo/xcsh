import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AuthCredentialStore } from "../src/auth-storage";
import {
	type AnthropicAuthEnvironment,
	buildAnthropicUrl,
	type FindAnthropicAuthOptions,
	findAnthropicAuth,
} from "../src/utils/anthropic-auth";

async function withEnv(
	overrides: AnthropicAuthEnvironment,
	fn: (environment: AnthropicAuthEnvironment) => void | Promise<void>,
): Promise<void> {
	await fn(overrides);
}

const emptyStore = {
	getApiKey: () => undefined,
	listAuthCredentials: () => [],
	close: () => {},
} as unknown as AuthCredentialStore;

let tempDir: string;

function authOptions(environment: AnthropicAuthEnvironment): FindAnthropicAuthOptions {
	return { store: emptyStore, environment, modelsYmlPath: path.join(tempDir, "models.yml") };
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-anthropic-litellm-"));
});

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("findAnthropicAuth litellm passthrough", () => {
	it("derives Anthropic auth from LITELLM_BASE_URL + LITELLM_API_KEY when no Anthropic credentials exist", async () => {
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
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).not.toBeNull();
				expect(auth?.apiKey).toBe("sk-litellm-test-key");
				expect(auth?.baseUrl).toBe("https://litellm.example.com/anthropic");
				expect(auth?.isOAuth).toBe(false);
				expect(buildAnthropicUrl(auth!)).toBe("https://litellm.example.com/anthropic/v1/messages?beta=true");
			},
		);
	});

	it("ANTHROPIC_API_KEY takes precedence over LITELLM_API_KEY", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: "sk-ant-direct-key",
				ANTHROPIC_BASE_URL: "https://api.anthropic.com",
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://litellm.example.com",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).not.toBeNull();
				expect(auth?.apiKey).toBe("sk-ant-direct-key");
				expect(auth?.baseUrl).toBe("https://api.anthropic.com");
			},
		);
	});

	it("returns null when neither Anthropic nor litellm credentials exist", async () => {
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
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).toBeNull();
			},
		);
	});

	it("strips trailing slashes from LITELLM_BASE_URL before appending /anthropic", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://litellm.example.com/",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).not.toBeNull();
				expect(auth?.baseUrl).toBe("https://litellm.example.com/anthropic");
			},
		);
	});

	it("does not double-append /anthropic if LITELLM_BASE_URL already ends with /anthropic", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://litellm.example.com/anthropic",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).not.toBeNull();
				expect(auth?.baseUrl).toBe("https://litellm.example.com/anthropic");
			},
		);
	});

	it("strips an /api/v1 suffix before appending /anthropic", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://proxy.example.com/api/v1",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth?.baseUrl).toBe("https://proxy.example.com/anthropic");
			},
		);
	});

	it("strips both /anthropic and /v1 suffixes regardless of order", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://proxy.example.com/anthropic/v1",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth?.baseUrl).toBe("https://proxy.example.com/anthropic");
			},
		);
	});

	it("iteratively strips mixed /v1/anthropic/v1 suffixes until stable", async () => {
		await withEnv(
			{
				ANTHROPIC_API_KEY: undefined,
				ANTHROPIC_BASE_URL: undefined,
				ANTHROPIC_SEARCH_API_KEY: undefined,
				ANTHROPIC_SEARCH_BASE_URL: undefined,
				ANTHROPIC_OAUTH_TOKEN: undefined,
				ANTHROPIC_FOUNDRY_API_KEY: undefined,
				CLAUDE_CODE_USE_FOUNDRY: undefined,
				LITELLM_BASE_URL: "https://proxy.example.com/v1/anthropic/v1",
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth?.baseUrl).toBe("https://proxy.example.com/anthropic");
			},
		);
	});

	it("requires both LITELLM_BASE_URL and LITELLM_API_KEY for litellm tier", async () => {
		// Only base URL, no key
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
				LITELLM_API_KEY: undefined,
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).toBeNull();
			},
		);

		// Only key, no base URL
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
				LITELLM_API_KEY: "sk-litellm-test-key",
			},
			async environment => {
				const auth = await findAnthropicAuth(authOptions(environment));
				expect(auth).toBeNull();
			},
		);
	});
});
