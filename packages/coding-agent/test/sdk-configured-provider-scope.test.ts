import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { createAgentSession } from "../src/sdk";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

/**
 * WS1 regression: automatic model selection must stay scoped to providers the
 * user actually configured (models.yml). Previously the "first available model"
 * fallback walked the entire bundled catalog; with a stale `AWS_PROFILE` in the
 * environment the env-gated Bedrock probe reported "authenticated" (without
 * validating the SSO token) and Bedrock — which sorts before anthropic — was
 * selected, dying later on `aws sso login`. Only the F5 anthropic proxy is
 * configured here, so Bedrock must never be chosen.
 */
describe("fallback model selection is scoped to configured providers", () => {
	let tempDir: string;
	let priorAwsProfile: string | undefined;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `xcsh-cfg-scope-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		priorAwsProfile = process.env.AWS_PROFILE;
		process.env.AWS_PROFILE = "some-expired-sso-profile";
	});

	afterEach(() => {
		if (priorAwsProfile === undefined) delete process.env.AWS_PROFILE;
		else process.env.AWS_PROFILE = priorAwsProfile;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function makeRegistry(): Promise<{ registry: ModelRegistry; auth: AuthStorage }> {
		const modelsYml = path.join(tempDir, "models.yml");
		// Only the F5 anthropic passthrough is configured — no amazon-bedrock block.
		fs.writeFileSync(
			modelsYml,
			[
				"configVersion: 2",
				"providers:",
				"  anthropic:",
				'    baseUrl: "https://litellm.example.com/anthropic"',
				'    apiKey: "sk-ant-test-key"',
				"",
			].join("\n"),
		);
		const auth = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const registry = new ModelRegistry(auth, modelsYml);
		return { registry, auth };
	}

	test("getConfiguredProviderIds reflects models.yml providers", async () => {
		const { registry, auth } = await makeRegistry();
		try {
			const configured = registry.getConfiguredProviderIds();
			expect(configured.has("anthropic")).toBe(true);
			expect(configured.has("amazon-bedrock")).toBe(false);
		} finally {
			auth.close();
		}
	});

	test("unresolvable default + AWS_PROFILE set → selects the configured anthropic proxy, never Bedrock", async () => {
		const { registry, auth } = await makeRegistry();
		// Force the fallback path: an unresolvable default role (the binary default
		// would otherwise resolve straight to anthropic/claude-opus-4-8). The fallback
		// must stay scoped to the configured anthropic provider and never touch Bedrock.
		const settings = Settings.isolated();
		settings.setModelRole("default", "anthropic/this-model-does-not-exist");
		try {
			const { session } = await createAgentSession({
				cwd: tempDir,
				agentDir: tempDir,
				authStorage: auth,
				modelRegistry: registry,
				settings,
				sessionManager: SessionManager.inMemory(),
				disableExtensionDiscovery: true,
				skills: [],
				contextFiles: [],
				promptTemplates: [],
				slashCommands: [],
				enableMCP: false,
				enableLsp: false,
			});
			try {
				expect(session.model?.provider).not.toBe("amazon-bedrock");
				expect(session.model?.provider).toBe("anthropic");
			} finally {
				await session.dispose();
			}
		} finally {
			auth.close();
		}
	});
});
