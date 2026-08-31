import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import type { TUI } from "@f5-sales-demo/pi-tui";
import type { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { ModelSelectorComponent, presentModelsForDefaultPicker } from "../src/modes/components/model-selector";
import { initTheme } from "../src/modes/theme/theme";

const model = (provider: string, id: string) => ({ provider, id, name: id }) as Model;

beforeAll(() => initTheme());

describe("default GPT-5.6 model picker presentation", () => {
	it("collapses raw ChatGPT tiers to one friendly Sol-backed selection", () => {
		const presented = presentModelsForDefaultPicker([
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
			model("anthropic", "claude-sonnet-4-6"),
		]);

		expect(presented.map(item => item.displaySelector)).toEqual([
			"openai-codex/gpt-5.6",
			"anthropic/claude-sonnet-4-6",
		]);
		expect(presented[0]).toMatchObject({
			selector: "openai-codex/gpt-5.6-sol",
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
		});
	});

	it("preserves explicit --models scoped access to every raw tier", () => {
		const tiers = [
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
		];
		expect(presentModelsForDefaultPicker(tiers, true).map(item => item.displaySelector)).toEqual([
			"openai-codex/gpt-5.6-luna",
			"openai-codex/gpt-5.6-terra",
			"openai-codex/gpt-5.6-sol",
		]);
	});

	it("renders one friendly row in both the normal and canonical tabs", async () => {
		const tiers = [
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
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
			Settings.isolated(),
			registry,
			[],
			() => {},
			() => {},
		);
		await Bun.sleep(0);

		const allTab = Bun.stripANSI(selector.render(180).join("\n"));
		expect(allTab).toContain("openai-codex/gpt-5.6");
		expect(allTab).not.toContain("gpt-5.6-luna");
		expect(allTab).not.toContain("gpt-5.6-terra");

		selector.handleInput("\t");
		const canonicalTab = Bun.stripANSI(selector.render(180).join("\n"));
		expect(canonicalTab).toContain("openai-codex/gpt-5.6");
		expect(canonicalTab).not.toContain("gpt-5.6-luna");
		expect(canonicalTab).not.toContain("gpt-5.6-terra");
	});
});
