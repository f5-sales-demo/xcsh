import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AuthCredentialStore } from "../src/auth-storage";
import {
	type AnthropicAuthEnvironment,
	type FindAnthropicAuthOptions,
	findAnthropicAuth,
} from "../src/utils/anthropic-auth";

const NEUTRALIZED_ENV: Record<string, string | undefined> = {
	ANTHROPIC_API_KEY: undefined,
	ANTHROPIC_BASE_URL: undefined,
	ANTHROPIC_SEARCH_API_KEY: undefined,
	ANTHROPIC_SEARCH_BASE_URL: undefined,
	ANTHROPIC_OAUTH_TOKEN: undefined,
	ANTHROPIC_FOUNDRY_API_KEY: undefined,
	CLAUDE_CODE_USE_FOUNDRY: undefined,
	LITELLM_BASE_URL: undefined,
	LITELLM_API_KEY: undefined,
};

const emptyStore = {
	getApiKey: () => undefined,
	listAuthCredentials: () => [],
	close: () => {},
} as unknown as AuthCredentialStore;

let tempDir: string;
let modelsYmlPath: string;

function authOptions(environment: AnthropicAuthEnvironment): FindAnthropicAuthOptions {
	return { store: emptyStore, environment, modelsYmlPath };
}

function stubModelsYml(content: string | null): void {
	if (content === null) {
		fs.rmSync(modelsYmlPath, { force: true });
		return;
	}
	fs.writeFileSync(modelsYmlPath, content);
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-anthropic-models-yml-"));
	modelsYmlPath = path.join(tempDir, "models.yml");
});

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("findAnthropicAuth tier 6 — models.yml contract", () => {
	it("resolves credentials when models.yml has a literal quoted apiKey", async () => {
		stubModelsYml(
			[
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://proxy.example.com/anthropic"',
				'    apiKey: "sk-literal-test-123"',
			].join("\n"),
		);
		const auth = await findAnthropicAuth(authOptions(NEUTRALIZED_ENV));
		expect(auth).not.toBeNull();
		expect(auth?.apiKey).toBe("sk-literal-test-123");
		expect(auth?.baseUrl).toBe("https://proxy.example.com/anthropic");
		expect(auth?.isOAuth).toBe(false);
	});

	it("resolves credentials via env-var reference when the referenced env var is set", async () => {
		stubModelsYml(
			[
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://proxy.example.com/anthropic"',
				"    apiKey: LITELLM_API_KEY",
			].join("\n"),
		);
		const auth = await findAnthropicAuth(authOptions({ ...NEUTRALIZED_ENV, LITELLM_API_KEY: "value" }));
		expect(auth).not.toBeNull();
		expect(auth?.apiKey).toBe("value");
		expect(auth?.baseUrl).toBe("https://proxy.example.com/anthropic");
	});

	it("falls through to tier 7 when env-var referenced by apiKey is unset", async () => {
		stubModelsYml(
			[
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://proxy.example.com/anthropic"',
				"    apiKey: UNDEFINED_ENV_VAR_XYZ",
			].join("\n"),
		);
		const auth = await findAnthropicAuth(
			authOptions({
				...NEUTRALIZED_ENV,
				LITELLM_BASE_URL: "https://proxy.example.com",
				LITELLM_API_KEY: "sk-tier7-fallback",
			}),
		);
		expect(auth?.apiKey).toBe("sk-tier7-fallback");
	});

	it("skips shell-secret apiKey (tier 6 returns null)", async () => {
		stubModelsYml(
			[
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://proxy.example.com/anthropic"',
				"    apiKey: !shellSecret get-key",
			].join("\n"),
		);
		expect(await findAnthropicAuth(authOptions(NEUTRALIZED_ENV))).toBeNull();
	});

	it("returns null when the anthropic provider block is absent", async () => {
		stubModelsYml(
			["providers:", "  openai:", '    baseUrl: "https://openai.example.com"', '    apiKey: "sk-openai"'].join("\n"),
		);
		expect(await findAnthropicAuth(authOptions(NEUTRALIZED_ENV))).toBeNull();
	});

	it("returns null when models.yml does not exist and does not throw", async () => {
		stubModelsYml(null);
		expect(await findAnthropicAuth(authOptions(NEUTRALIZED_ENV))).toBeNull();
	});

	it("returns null on malformed YAML without throwing", async () => {
		stubModelsYml("::: not valid yaml {[broken");
		expect(await findAnthropicAuth(authOptions(NEUTRALIZED_ENV))).toBeNull();
	});

	it("returns null when anthropic block has baseUrl but no apiKey", async () => {
		stubModelsYml(["providers:", "  anthropic:", '    baseUrl: "https://proxy.example.com/anthropic"'].join("\n"));
		expect(await findAnthropicAuth(authOptions(NEUTRALIZED_ENV))).toBeNull();
	});

	it("returns null when anthropic block has apiKey but no baseUrl", async () => {
		stubModelsYml(["providers:", "  anthropic:", '    apiKey: "sk-test"'].join("\n"));
		expect(await findAnthropicAuth(authOptions(NEUTRALIZED_ENV))).toBeNull();
	});

	it("tier 6 wins over tier 7 when both are available", async () => {
		stubModelsYml(
			[
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://primary.example.com/anthropic"',
				'    apiKey: "sk-models-yml-wins"',
			].join("\n"),
		);
		const auth = await findAnthropicAuth(
			authOptions({
				...NEUTRALIZED_ENV,
				LITELLM_BASE_URL: "https://secondary.example.com",
				LITELLM_API_KEY: "sk-tier7-loses",
			}),
		);
		expect(auth?.apiKey).toBe("sk-models-yml-wins");
		expect(auth?.baseUrl).toBe("https://primary.example.com/anthropic");
	});

	it("full-chain integration: only models.yml has credentials, no env, no DB", async () => {
		stubModelsYml(
			[
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://proxy.example.com/anthropic"',
				'    apiKey: "sk-only-models-yml"',
			].join("\n"),
		);
		const auth = await findAnthropicAuth(authOptions(NEUTRALIZED_ENV));
		expect(auth).not.toBeNull();
		expect(auth?.apiKey).toBe("sk-only-models-yml");
		expect(auth?.baseUrl).toBe("https://proxy.example.com/anthropic");
		expect(auth?.isOAuth).toBe(false);
	});
});
