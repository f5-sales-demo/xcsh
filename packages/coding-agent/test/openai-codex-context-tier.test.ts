import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { SETTINGS_SCHEMA } from "../src/config/settings-schema";
import { AuthStorage } from "../src/session/auth-storage";

describe("provider-specific OpenAI context tiers", () => {
	it("replaces Boolean aliases with standard, codex-max, and provider-max", async () => {
		const defaults = Settings.isolated();
		expect(defaults.get("providers.openaiContextTier")).toBe("standard");
		expect(defaults.get("providers.litellmContextTier")).toBe("standard");
		expect(SETTINGS_SCHEMA).not.toHaveProperty("providers.openaiCodexMaxContext");
		expect(SETTINGS_SCHEMA).not.toHaveProperty("providers.litellmMaxContext");

		const auth = await AuthStorage.create(path.join(os.tmpdir(), `context-tier-${crypto.randomUUID()}.db`));
		const registry = new ModelRegistry(auth, undefined, {
			getOpenAIContextTier: () => "codex-max",
			getLiteLLMContextTier: () => "provider-max",
		});
		const sol = registry.find("openai-codex", "gpt-6-sol");
		expect(sol).toMatchObject({
			contextWindow: 872_000,
			effectiveContextWindow: 828_400,
			autoCompactTokenLimit: 784_800,
		});

		registry.setOpenAIContextTier("standard");
		expect(sol).toMatchObject({
			contextWindow: 272_000,
			effectiveContextWindow: 258_400,
			autoCompactTokenLimit: 244_800,
		});
		auth.close();
	});
});
