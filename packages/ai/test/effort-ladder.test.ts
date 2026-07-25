import { describe, expect, it } from "bun:test";
import {
	Effort,
	getBundledModel,
	type Model,
	mapEffortToAnthropicAdaptiveEffort,
	mapEffortToGoogleThinkingLevel,
	THINKING_EFFORTS,
} from "@f5-sales-demo/pi-ai";

/**
 * Regression for #2342: xcsh could not express the Anthropic API's `xhigh`
 * effort — `Effort.XHigh` mapped to the wire value `"max"`, so the ladder
 * jumped `high` → `max` and skipped the level Anthropic documents as the best
 * setting for coding/agentic work.
 *
 * The API's own validation error is the authority on the enum:
 *   output_config.effort: Input should be 'low', 'medium', 'high', 'xhigh' or 'max'
 * Note `minimal` is NOT in it — it is an xcsh-internal level that must always
 * be translated down before reaching the wire.
 */
const API_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const anthropic = (id: string) => getBundledModel("anthropic", id) as Model<"anthropic-messages">;

describe("Effort ladder", () => {
	it("is ordered least→most intensive and ends at max", () => {
		expect(THINKING_EFFORTS).toEqual([
			Effort.Minimal,
			Effort.Low,
			Effort.Medium,
			Effort.High,
			Effort.XHigh,
			Effort.Max,
		]);
	});
});

describe("mapEffortToAnthropicAdaptiveEffort", () => {
	const model = anthropic("claude-opus-5");

	it("maps XHigh to the API's xhigh (not max)", () => {
		expect(mapEffortToAnthropicAdaptiveEffort(model, Effort.XHigh)).toBe("xhigh");
	});

	it("maps Max to the API's max", () => {
		expect(mapEffortToAnthropicAdaptiveEffort(model, Effort.Max)).toBe("max");
	});

	it("translates the xcsh-only Minimal level down to low (minimal would 400)", () => {
		expect(mapEffortToAnthropicAdaptiveEffort(model, Effort.Minimal)).toBe("low");
	});

	it("only ever emits values in the API's enum", () => {
		for (const effort of THINKING_EFFORTS) {
			const wire = mapEffortToAnthropicAdaptiveEffort(model, effort);
			expect(API_EFFORTS).toContain(wire);
			expect(wire).not.toBe("minimal");
		}
	});
});

describe("catalog effort ranges", () => {
	for (const id of ["claude-opus-5", "claude-sonnet-5"]) {
		it(`${id} reaches max and can express xhigh`, () => {
			const model = anthropic(id);
			expect(model.thinking?.maxLevel).toBe(Effort.Max);
			// The whole point of #2342: xhigh must be reachable, not skipped.
			expect(mapEffortToAnthropicAdaptiveEffort(model, Effort.XHigh)).toBe("xhigh");
			expect(mapEffortToAnthropicAdaptiveEffort(model, Effort.Max)).toBe("max");
		});
	}

	it("keeps sonnet-4-6 below xhigh (it does not support that level) — #2341", () => {
		expect(anthropic("claude-sonnet-4-6").thinking?.maxLevel).toBe(Effort.High);
	});
});

describe("other providers are unaffected", () => {
	it("Gemini wire values are unchanged", () => {
		const gemini = getBundledModel("google", "gemini-3-pro-preview");
		expect(mapEffortToGoogleThinkingLevel(gemini, Effort.Low)).toBe("LOW");
		expect(mapEffortToGoogleThinkingLevel(gemini, Effort.High)).toBe("HIGH");
	});
});
