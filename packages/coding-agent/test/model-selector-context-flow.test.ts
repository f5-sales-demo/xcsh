import { beforeAll, expect, test, vi } from "bun:test";
import { createThinkingConfig, type Model, ReasoningEffort } from "@f5-sales-demo/pi-ai";
import type { TUI } from "@f5-sales-demo/pi-tui";
import type { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { ModelSelectorComponent } from "../src/modes/components/model-selector";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(() => initTheme());

test("chooses reasoning and provider-wide context before scope without losing the selected model", async () => {
	const model = {
		provider: "openai-codex",
		id: "gpt-6-sol",
		name: "GPT-6 Sol",
		contextWindow: 272_000,
		maxContextWindow: 872_000,
		providerContextWindow: 922_000,
		effectiveContextWindowPercent: 95,
		autoCompactThresholdPercent: 90,
		thinking: createThinkingConfig([ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High]),
	} as Model;
	const onSelect = vi.fn(() => true);
	const selector = new ModelSelectorComponent(
		{ requestRender: vi.fn() } as unknown as TUI,
		model,
		Settings.isolated({ "providers.openaiContextTier": "standard" }),
		{ getAll: () => [model], getAvailable: () => [model], getError: () => undefined } as unknown as ModelRegistry,
		[],
		onSelect,
		vi.fn(),
	);
	await Bun.sleep(0);
	selector.handleInput("\r");
	expect(Bun.stripANSI(selector.render(100).join("\n"))).toContain("Reasoning");
	selector.handleInput("\r");
	let rendered = Bun.stripANSI(selector.render(100).join("\n"));
	expect(rendered).toContain("Context window");
	expect(rendered).toContain("Standard — 272K");
	expect(rendered).toContain("Codex maximum — 872K");
	expect(rendered).toContain("Provider maximum — 922K");
	expect(rendered).toContain("provider-wide");
	selector.handleInput("\x1b[B");
	selector.handleInput("\r");
	rendered = Bun.stripANSI(selector.render(100).join("\n"));
	expect(rendered).toContain("Choose where this model applies");
	selector.handleInput("\r");
	expect(onSelect).toHaveBeenCalledWith(
		expect.objectContaining({
			selector: "openai-codex/gpt-6-sol",
			thinkingLevel: "inherit",
			contextTier: "codex-max",
			scope: "conversation",
		}),
	);
});
