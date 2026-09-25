import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effort, ReasoningEffort } from "@f5-sales-demo/pi-ai";
import { streamOpenAIResponses } from "@f5-sales-demo/pi-ai/providers/openai-responses";
import type { Model } from "@f5-sales-demo/pi-ai/types";
import { YAML } from "bun";
import { CURRENT_CONFIG_VERSION, generateModelsYml } from "../src/config/auto-config";
import { ModelRegistry } from "../src/config/model-registry";
import { restoreModelFromSession } from "../src/config/model-resolver";
import { DEFAULT_MODEL_ROLE, SETTINGS_SCHEMA } from "../src/config/settings-schema";
import { filterCurrentBrowserModels } from "../src/modes/components/model-selector";
import { getLiteLLMLoginModelRoles, LITELLM_LOGIN_MODEL_CHOICES } from "../src/modes/controllers/login-model";
import { BUILTIN_ROUTING_PRESETS } from "../src/routing/presets";
import { AuthStorage } from "../src/session/auth-storage";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const CURRENT_OPENAI_IDS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-6-sol", "gpt-6-astra"] as const;
const CURRENT_ANTHROPIC_IDS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5-5"] as const;
const LEGACY_OPENAI_IDS = ["gpt-5.6-luna", "gpt-5.6-sol"] as const;

describe("current internal LiteLLM model contract", () => {
	let tempDir: string;
	let modelsPath: string;
	let authStorage: AuthStorage;

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-litellm-current-"));
		modelsPath = path.join(tempDir, "models.yml");
		authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		fs.writeFileSync(
			modelsPath,
			generateModelsYml("https://proxy.example.com", {
				apiBasePath: "/api/v1",
				apiKeyLiteral: "synthetic-test-key",
			}),
		);
	});

	afterEach(() => {
		authStorage.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("generates v9 with route-accurate current and legacy-resolvable providers", () => {
		const document = YAML.parse(fs.readFileSync(modelsPath, "utf8")) as {
			configVersion: number;
			providers: {
				anthropic: { api: string; baseUrl: string; modelAllowlist: string[] };
				litellm: {
					api: string;
					baseUrl: string;
					modelAllowlist: string[];
					models: Array<{ id: string; api: string; baseUrl?: string }>;
				};
			};
		};
		expect(CURRENT_CONFIG_VERSION).toBe(9);
		expect(document.configVersion).toBe(9);

		const anthropic = document.providers.anthropic;
		expect(anthropic.api).toBe("anthropic-messages");
		expect(anthropic.baseUrl).toBe("https://proxy.example.com/anthropic");
		expect(anthropic.modelAllowlist).toEqual([...CURRENT_ANTHROPIC_IDS, "claude-opus-5"]);

		const openai = document.providers.litellm;
		expect(openai.api).toBe("openai-completions");
		expect(openai.baseUrl).toBe("https://proxy.example.com/api/v1");
		expect(openai.modelAllowlist).toEqual([...CURRENT_OPENAI_IDS, ...LEGACY_OPENAI_IDS]);

		const byId = new Map(openai.models.map((model: { id: string }) => [model.id, model]));
		for (const id of ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]) {
			expect(byId.get(id)).toMatchObject({
				id,
				api: "openai-responses",
				baseUrl: "https://proxy.example.com/openai/v1",
			});
		}
		expect(byId.get("gpt-5.6-terra")).toMatchObject({ id: "gpt-5.6-terra", api: "openai-completions" });
	});

	it("exposes exact route, capability, effort, limit, and zero-cost metadata", () => {
		const registry = new ModelRegistry(authStorage, modelsPath, { getLiteLLMMaxContext: () => true });
		const expectedEfforts = new Map<string, ReasoningEffort[]>([
			[
				"gpt-6-luna",
				[ReasoningEffort.None, Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max],
			],
			[
				"gpt-5.6-terra",
				[ReasoningEffort.None, Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max],
			],
			[
				"gpt-6-sol",
				[ReasoningEffort.None, Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max],
			],
			["gpt-6-astra", [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max]],
		]);

		for (const id of CURRENT_OPENAI_IDS) {
			const model = registry.find("litellm", id);
			expect(model).toMatchObject({
				api: id === "gpt-5.6-terra" ? "openai-completions" : "openai-responses",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO_COST,
				contextWindow: 1_050_000,
				maxTokens: 128_000,
				compat: { supportsTemperature: false },
			});
			expect(model?.thinking?.supportedLevels.map(level => level.effort)).toEqual(expectedEfforts.get(id));
		}

		for (const [id, contextWindow, maxTokens] of [
			["claude-haiku-4-5", 200_000, 64_000],
			["claude-sonnet-5", 1_000_000, 128_000],
			["claude-opus-5-5", 1_000_000, 128_000],
		] as const) {
			expect(registry.find("anthropic", id)).toMatchObject({
				api: "anthropic-messages",
				baseUrl: "https://proxy.example.com/anthropic",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO_COST,
				contextWindow,
				maxTokens,
				compat: { supportsToolChoice: false },
			});
		}
		for (const id of [...CURRENT_ANTHROPIC_IDS, "claude-opus-5"]) {
			expect(registry.find("anthropic", id)?.baseUrl).toBe("https://proxy.example.com/anthropic");
		}
	});

	it("builds GPT-6 requests as OpenAI Responses payloads", async () => {
		const registry = new ModelRegistry(authStorage, modelsPath);
		const model = registry.find("litellm", "gpt-6-sol") as Model<"openai-responses">;
		const controller = new AbortController();
		controller.abort();
		const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();

		streamOpenAIResponses(
			model,
			{ messages: [{ role: "user", content: "Reply with PONG", timestamp: 1 }] },
			{
				apiKey: "synthetic-test-key",
				reasoning: "high",
				signal: controller.signal,
				onPayload: payload => resolve(payload as unknown as Record<string, unknown>),
			},
		);

		const payload = await promise;
		expect(model).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://proxy.example.com/openai/v1",
		});
		expect(payload).toMatchObject({
			model: "gpt-6-sol",
			stream: true,
			store: false,
			reasoning: { effort: "high", summary: "auto" },
		});
		expect(payload).toHaveProperty("input");
		expect(payload).not.toHaveProperty("messages");
	});

	it("shows exactly seven current models while retaining legacy selectors", () => {
		const registry = new ModelRegistry(authStorage, modelsPath);
		const visible = filterCurrentBrowserModels(registry.getAll()).filter(
			model => model.provider === "litellm" || model.provider === "anthropic",
		);
		expect(visible.map(model => `${model.provider}/${model.id}`).sort()).toEqual(
			[
				...CURRENT_OPENAI_IDS.map(id => `litellm/${id}`),
				...CURRENT_ANTHROPIC_IDS.map(id => `anthropic/${id}`),
			].sort(),
		);
		for (const id of LEGACY_OPENAI_IDS) expect(registry.find("litellm", id)).toBeDefined();
		expect(registry.find("anthropic", "claude-opus-5")).toBeDefined();
	});

	it("restores historical sessions that selected hidden legacy models", async () => {
		const registry = new ModelRegistry(authStorage, modelsPath);
		for (const [provider, id] of [
			["litellm", "gpt-5.6-luna"],
			["litellm", "gpt-5.6-sol"],
			["anthropic", "claude-opus-5"],
		] as const) {
			const restored = await restoreModelFromSession(provider, id, undefined, false, registry);
			expect(restored.model).toMatchObject({ provider, id });
			expect(restored.fallbackMessage).toBeUndefined();
		}
	});

	it("assigns current LiteLLM login roles and native Anthropic routing", () => {
		expect(DEFAULT_MODEL_ROLE).toBe("litellm/gpt-5.6-terra:medium");
		expect(SETTINGS_SCHEMA.modelRoles.default).toEqual({
			smol: "litellm/gpt-6-luna:low",
			default: "litellm/gpt-5.6-terra:medium",
			slow: "litellm/gpt-6-sol:high",
			plan: "litellm/gpt-6-sol:high",
		});
		expect(LITELLM_LOGIN_MODEL_CHOICES.map(choice => `${choice.provider}/${choice.modelId}`)).toEqual([
			"litellm/gpt-6-sol",
			"anthropic/claude-opus-5-5",
		]);
		expect(getLiteLLMLoginModelRoles(LITELLM_LOGIN_MODEL_CHOICES[0]!)).toEqual({
			smol: "litellm/gpt-6-luna:low",
			default: "litellm/gpt-5.6-terra:medium",
			slow: "litellm/gpt-6-sol:high",
			plan: "litellm/gpt-6-sol:high",
		});
		expect(getLiteLLMLoginModelRoles(LITELLM_LOGIN_MODEL_CHOICES[1]!)).toEqual({
			smol: "anthropic/claude-haiku-4-5:low",
			default: "anthropic/claude-sonnet-5:medium",
			slow: "anthropic/claude-opus-5-5:high",
			plan: "anthropic/claude-opus-5-5:high",
		});
		expect(BUILTIN_ROUTING_PRESETS["litellm/openai"]).toMatchObject({
			provider: "litellm",
			tiers: { utility: "gpt-6-luna", balanced: "gpt-5.6-terra", frontier: "gpt-6-sol" },
		});
		expect(BUILTIN_ROUTING_PRESETS["litellm/anthropic"]).toMatchObject({
			provider: "anthropic",
			tiers: { utility: "claude-haiku-4-5", balanced: "claude-sonnet-5", frontier: "claude-opus-5-5" },
		});
	});

	it("keeps maximum-context controls independent across discovery refreshes", async () => {
		expect(SETTINGS_SCHEMA["providers.litellmMaxContext"]).toMatchObject({
			type: "boolean",
			default: false,
			ui: { tab: "providers", label: "LiteLLM Maximum Context" },
		});
		expect(SETTINGS_SCHEMA["providers.openaiCodexMaxContext"].default).toBe(false);

		const registry = new ModelRegistry(authStorage, modelsPath, { getLiteLLMMaxContext: () => false });
		for (const id of CURRENT_OPENAI_IDS) expect(registry.find("litellm", id)?.contextWindow).toBe(272_000);
		expect(registry.find("anthropic", "claude-opus-5-5")?.contextWindow).toBe(1_000_000);
		await registry.refreshProvider("litellm", "offline");
		for (const id of CURRENT_OPENAI_IDS) expect(registry.find("litellm", id)?.contextWindow).toBe(272_000);

		registry.setLiteLLMMaxContext(true);
		for (const id of CURRENT_OPENAI_IDS) expect(registry.find("litellm", id)?.contextWindow).toBe(1_050_000);
		expect(registry.find("anthropic", "claude-opus-5-5")?.contextWindow).toBe(1_000_000);
	});
});
