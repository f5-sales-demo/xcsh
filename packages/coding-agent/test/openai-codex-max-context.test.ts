import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { SETTINGS_SCHEMA } from "../src/config/settings-schema";
import { AuthStorage } from "../src/session/auth-storage";

describe("OpenAI Codex maximum context toggle", () => {
	it("defaults to 272K and opt-in raises only GPT-6 Luna and Sol to the published 1.05M window", async () => {
		const defaults = Settings.isolated();
		expect(defaults.get("providers.openaiCodexMaxContext")).toBe(false);
		expect(SETTINGS_SCHEMA["providers.openaiCodexMaxContext"].ui).toMatchObject({
			tab: "providers",
			label: "OpenAI Codex Maximum Context",
		});

		const enabled = Settings.isolated({ "providers.openaiCodexMaxContext": true });
		const auth = await AuthStorage.create(path.join(os.tmpdir(), `max-context-${crypto.randomUUID()}.db`));
		const defaultRegistry = new ModelRegistry(auth);
		expect(defaultRegistry.find("openai-codex", "gpt-6-luna")?.contextWindow).toBe(272_000);
		expect(defaultRegistry.find("openai-codex", "gpt-6-sol")?.contextWindow).toBe(272_000);

		const registry = new ModelRegistry(auth, undefined, {
			getOpenAICodexMaxContext: () => enabled.get("providers.openaiCodexMaxContext"),
		});

		expect(registry.find("openai-codex", "gpt-6-luna")?.contextWindow).toBe(1_050_000);
		const sol = registry.find("openai-codex", "gpt-6-sol");
		expect(sol?.contextWindow).toBe(1_050_000);
		const liteLLMContext = registry.find("litellm", "gpt-5.6-sol")?.contextWindow;

		registry.setOpenAICodexMaxContext(false);
		expect(registry.find("openai-codex", "gpt-6-luna")?.contextWindow).toBe(272_000);
		expect(registry.find("openai-codex", "gpt-6-sol")?.contextWindow).toBe(272_000);
		expect(sol?.contextWindow).toBe(272_000);
		expect(registry.find("litellm", "gpt-5.6-sol")?.contextWindow).toBe(liteLLMContext);
		auth.close();
	});
});
