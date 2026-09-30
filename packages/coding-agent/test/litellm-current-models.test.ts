import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effort, ReasoningEffort } from "@f5-sales-demo/pi-ai";
import { streamOpenAIResponses } from "@f5-sales-demo/pi-ai/providers/openai-responses";
import type { Context, Model } from "@f5-sales-demo/pi-ai/types";
import { Type } from "@sinclair/typebox";
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
const CURRENT_OPENAI_IDS = [
	"gpt-6-luna",
	"gpt-5.6-terra",
	"gpt-6.1-sol",
	"gpt-6-sol",
	"gpt-6-astra",
	"gpt-5.6-luna",
	"gpt-5.6-sol",
	"gpt-5.5",
] as const;
const CURRENT_ANTHROPIC_IDS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5-5"] as const;

describe("current internal LiteLLM model contract", () => {
	let tempDir: string;
	let modelsPath: string;
	let authStorage: AuthStorage;
	let previousBaseUrl: string | undefined;
	let previousApiKey: string | undefined;

	beforeEach(async () => {
		previousBaseUrl = Bun.env.LITELLM_BASE_URL;
		previousApiKey = Bun.env.LITELLM_API_KEY;
		delete Bun.env.LITELLM_BASE_URL;
		delete Bun.env.LITELLM_API_KEY;
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
		if (previousBaseUrl === undefined) delete Bun.env.LITELLM_BASE_URL;
		else Bun.env.LITELLM_BASE_URL = previousBaseUrl;
		if (previousApiKey === undefined) delete Bun.env.LITELLM_API_KEY;
		else Bun.env.LITELLM_API_KEY = previousApiKey;
	});

	it("generates v12 with Responses routing for all OpenAI interaction models", () => {
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
		expect(CURRENT_CONFIG_VERSION).toBe(12);
		expect(document.configVersion).toBe(12);

		const anthropic = document.providers.anthropic;
		expect(anthropic.api).toBe("anthropic-messages");
		expect(anthropic.baseUrl).toBe("https://proxy.example.com/anthropic");
		expect(anthropic.modelAllowlist).toEqual([...CURRENT_ANTHROPIC_IDS, "claude-opus-5"]);

		const openai = document.providers.litellm;
		expect(openai.api).toBe("openai-completions");
		expect(openai.baseUrl).toBe("https://proxy.example.com/api/v1");
		expect(openai.modelAllowlist).toEqual([...CURRENT_OPENAI_IDS]);

		const byId = new Map(openai.models.map((model: { id: string }) => [model.id, model]));
		for (const id of CURRENT_OPENAI_IDS) {
			expect(byId.get(id)).toMatchObject({
				id,
				api: "openai-responses",
				baseUrl: "https://proxy.example.com/openai/v1",
			});
		}
	});

	it("exposes exact route, capability, effort, limit, and zero-cost metadata", () => {
		const registry = new ModelRegistry(authStorage, modelsPath, { getLiteLLMContextTier: () => "provider-max" });
		const expectedEfforts = new Map<string, ReasoningEffort[]>([
			["gpt-6.1-sol", [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max]],
			["gpt-6-luna", [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max]],
			[
				"gpt-5.6-terra",
				[Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max, ReasoningEffort.Ultra],
			],
			[
				"gpt-6-sol",
				[Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max, ReasoningEffort.Ultra],
			],
			[
				"gpt-6-astra",
				[Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max, ReasoningEffort.Ultra],
			],
			[
				"gpt-5.6-sol",
				[Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max, ReasoningEffort.Ultra],
			],
			["gpt-5.6-luna", [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, ReasoningEffort.Max]],
			["gpt-5.5", [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh]],
		]);

		for (const id of CURRENT_OPENAI_IDS) {
			const model = registry.find("litellm", id);
			expect(model).toMatchObject({
				api: "openai-responses",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO_COST,
				contextWindow: /^gpt-6(?:\.1)?-/.test(id) ? 922_000 : 1_050_000,
				maxTokens: 128_000,
				compat: { supportsTemperature: false },
				defaultReasoningSummary: "none",
				defaultVerbosity: "low",
				serviceTiers: ["default", "priority"],
				truncationPolicy: { mode: "tokens", limit: 10_000 },
				supportsParallelToolCalls: true,
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
			{
				messages: [{ role: "user", content: "Reply with PONG", timestamp: 1 }],
				tools: [{ name: "probe", description: "Run a probe", parameters: Type.Object({}) }],
			},
			{
				apiKey: "synthetic-test-key",
				reasoning: "high",
				sessionId: "stable-session",
				metadata: { source: "xcsh", attempt: 1 },
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
			tool_choice: "auto",
			parallel_tool_calls: true,
			reasoning: { effort: "high" },
			text: { verbosity: "low" },
			include: ["reasoning.encrypted_content"],
			service_tier: "priority",
			prompt_cache_key: "stable-session",
			client_metadata: { source: "xcsh", attempt: "1" },
		});
		expect(payload).toHaveProperty("input");
		expect(payload).not.toHaveProperty("messages");
	});

	it("applies the Codex tool-result truncation policy on LiteLLM Responses", async () => {
		const registry = new ModelRegistry(authStorage, modelsPath);
		const model = {
			...(registry.find("litellm", "gpt-6-sol") as Model<"openai-responses">),
			truncationPolicy: { mode: "tokens" as const, limit: 10 },
		};
		const callId = "call_1";
		const context: Context = {
			messages: [
				{ role: "user", content: "Run the probe", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "toolCall", id: callId, name: "probe", arguments: {} }],
					api: "openai-responses",
					provider: "litellm",
					model: "gpt-6-sol",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: callId,
					toolName: "probe",
					content: [{ type: "text", text: "a".repeat(60) }],
					isError: false,
					timestamp: 3,
				},
			],
		};
		const controller = new AbortController();
		controller.abort();
		const { promise, resolve } = Promise.withResolvers<{ input?: Array<Record<string, unknown>> }>();
		streamOpenAIResponses(model, context, {
			apiKey: "synthetic-test-key",
			signal: controller.signal,
			onPayload: payload => resolve(payload as { input?: Array<Record<string, unknown>> }),
		});

		const output = (await promise).input?.find(item => item.type === "function_call_output")?.output;
		expect(output).toBe(`${"a".repeat(20)}…5 tokens truncated…${"a".repeat(20)}`);
	});

	it("shows all eight provider-advertised OpenAI models", () => {
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
		expect(registry.find("anthropic", "claude-opus-5")).toBeDefined();
	});

	it("restores sessions for every configured GPT-5.6 variant", async () => {
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
		expect(DEFAULT_MODEL_ROLE).toBe("litellm/gpt-6.1-sol:medium");
		expect(SETTINGS_SCHEMA.modelRoles.default).toEqual({
			smol: "litellm/gpt-6-luna:low",
			default: "litellm/gpt-6.1-sol:medium",
			slow: "litellm/gpt-6.1-sol:high",
			plan: "litellm/gpt-6.1-sol:high",
		});
		expect(LITELLM_LOGIN_MODEL_CHOICES.map(choice => `${choice.provider}/${choice.modelId}`)).toEqual([
			"litellm/gpt-6.1-sol",
			"anthropic/claude-opus-5-5",
		]);
		expect(getLiteLLMLoginModelRoles(LITELLM_LOGIN_MODEL_CHOICES[0]!)).toEqual({
			smol: "litellm/gpt-6-luna:low",
			default: "litellm/gpt-6.1-sol:medium",
			slow: "litellm/gpt-6.1-sol:high",
			plan: "litellm/gpt-6.1-sol:high",
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
		expect(SETTINGS_SCHEMA["providers.litellmContextTier"]).toMatchObject({
			type: "enum",
			default: "standard",
			ui: { tab: "providers", label: "LiteLLM Context Tier" },
		});
		expect(SETTINGS_SCHEMA["providers.openaiContextTier"].default).toBe("standard");

		const registry = new ModelRegistry(authStorage, modelsPath, { getLiteLLMContextTier: () => "standard" });
		for (const id of CURRENT_OPENAI_IDS) expect(registry.find("litellm", id)?.contextWindow).toBe(272_000);
		expect(registry.find("anthropic", "claude-opus-5-5")?.contextWindow).toBe(1_000_000);
		await registry.refreshProvider("litellm", "offline");
		for (const id of CURRENT_OPENAI_IDS) expect(registry.find("litellm", id)?.contextWindow).toBe(272_000);

		registry.setLiteLLMContextTier("codex-max");
		for (const id of CURRENT_OPENAI_IDS) {
			expect(registry.find("litellm", id)?.contextWindow).toBe(id === "gpt-5.5" ? 272_000 : 872_000);
		}
		registry.setLiteLLMContextTier("provider-max");
		for (const id of CURRENT_OPENAI_IDS) {
			expect(registry.find("litellm", id)?.contextWindow).toBe(/^gpt-6(?:\.1)?-/.test(id) ? 922_000 : 1_050_000);
		}
		expect(registry.find("anthropic", "claude-opus-5-5")?.contextWindow).toBe(1_000_000);
	});
});
