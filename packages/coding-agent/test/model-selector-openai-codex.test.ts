import { beforeAll, describe, expect, it, vi } from "bun:test";
import { createThinkingConfig, Effort, type Model, ReasoningEffort } from "@f5-sales-demo/pi-ai";
import type { TUI } from "@f5-sales-demo/pi-tui";
import type { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import {
	getModelSearchText,
	ModelSelectorComponent,
	presentModelsForDefaultPicker,
} from "../src/modes/components/model-selector";
import { initTheme } from "../src/modes/theme/theme";
import { SUBSCRIPTION_ROUTING_PROFILES } from "../src/routing/subscription-profiles";

const model = (provider: string, id: string, metadata: Partial<Model> = {}) =>
	({ provider, id, name: id, ...metadata }) as Model;

beforeAll(() => initTheme());

describe("default ChatGPT subscription model picker presentation", () => {
	it("keeps every ChatGPT tier and Astra as exact selections", () => {
		const presented = presentModelsForDefaultPicker([
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
			model("openai-codex", "gpt-6-astra"),
			model("anthropic", "claude-sonnet-4-6"),
		]);

		expect(presented.map(item => item.displaySelector)).toEqual([
			"openai-codex/gpt-5.6-luna",
			"openai-codex/gpt-5.6-terra",
			"openai-codex/gpt-5.6-sol",
			"openai-codex/gpt-6-astra",
			"anthropic/claude-sonnet-4-6",
		]);
		expect(presented.some(item => item.selector === "openai-codex/gpt-5.6")).toBe(false);
	});

	it("preserves explicit --models scoped access to every raw tier", () => {
		const tiers = [
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
			model("openai-codex", "gpt-6-astra"),
		];
		expect(presentModelsForDefaultPicker(tiers, true).map(item => item.displaySelector)).toEqual([
			"openai-codex/gpt-5.6-luna",
			"openai-codex/gpt-5.6-terra",
			"openai-codex/gpt-5.6-sol",
			"openai-codex/gpt-6-astra",
		]);
	});

	it("renders all tiers and unassigned Astra in the ChatGPT provider tab without a synthetic alias", async () => {
		const tiers = [
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
			model("openai-codex", "gpt-6-astra", { name: "GPT-6 Astra" }),
		];
		const byId = new Map(tiers.map(item => [item.id, item]));
		const registry = {
			refresh: vi.fn(async () => undefined),
			getError: () => undefined,
			getAll: () => tiers,
			getAvailable: () => tiers,
			getDiscoverableProviders: () => [],
			getCanonicalModels: () =>
				tiers.map(item => ({
					id: item.id,
					name: item.name,
					variants: [{ selector: `${item.provider}/${item.id}`, model: item }],
				})),
			resolveCanonicalModel: (id: string) => byId.get(id),
		} as unknown as ModelRegistry;
		const selector = new ModelSelectorComponent(
			{ requestRender: vi.fn() } as unknown as TUI,
			undefined,
			Settings.isolated({ modelRoles: SUBSCRIPTION_ROUTING_PROFILES["openai-codex"].roles }),
			registry,
			[],
			() => {},
			() => {},
		);
		await Bun.sleep(0);

		const allModels = Bun.stripANSI(selector.render(180).join("\n"));
		const normalizedModels = allModels.replace(/\s+/g, " ");
		expect(allModels).toContain("ChatGPT");
		expect(normalizedModels).toContain("GPT-5.6 Luna");
		expect(normalizedModels).toContain("GPT-5.6 Terra");
		expect(normalizedModels).toContain("GPT-5.6 Sol");
		expect(normalizedModels).toContain("GPT-6 Astra");
		for (const id of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]) {
			selector.getSearchInput().setValue("");
			for (const character of id) selector.handleInput(character);
			const detail = Bun.stripANSI(selector.render(120).join("\n"));
			expect(detail).toContain(`openai-codex/${id}`);
			if (id === "gpt-6-astra") expect(detail).toContain("Unassigned");
		}
		expect(allModels).not.toContain("ALL MODELS");
	});

	it("passes the exact chosen effort through temporary selection", async () => {
		const tier = {
			...model("openai-codex", "gpt-5.6-sol"),
			reasoning: true,
			thinking: createThinkingConfig([
				ReasoningEffort.None,
				Effort.Low,
				Effort.Medium,
				Effort.High,
				Effort.XHigh,
				Effort.Max,
			]),
		};
		const onSelect = vi.fn();
		const registry = {
			refresh: vi.fn(async () => undefined),
			getError: () => undefined,
			getAll: () => [tier],
			getAvailable: () => [tier],
			getDiscoverableProviders: () => [],
			getCanonicalModels: () => [],
			resolveCanonicalModel: () => undefined,
		} as unknown as ModelRegistry;
		const selector = new ModelSelectorComponent(
			{ requestRender: vi.fn() } as unknown as TUI,
			tier,
			Settings.isolated(),
			registry,
			[],
			onSelect,
			() => {},
			{ temporaryOnly: true },
		);
		await Bun.sleep(0);
		selector.handleInput("\r");
		selector.handleInput("\r");
		selector.handleInput("\x1b[B");
		selector.handleInput("\x1b[B");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith({
			model: tier,
			scope: "conversation",
			thinkingLevel: Effort.Low,
			selector: "openai-codex/gpt-5.6-sol",
		});
	});

	it("searches presentation metadata as well as the selector", () => {
		const presented = presentModelsForDefaultPicker([
			{
				...model("openai-codex", "gpt-5.6-terra"),
				publisher: "OpenAI",
				family: "GPT-5.6",
				tier: "Terra",
				name: "GPT-5.6 Terra",
			},
		])[0]!;
		expect(getModelSearchText(presented)).toContain("OpenAI GPT-5.6 Terra GPT-5.6 Terra");
	});
});
