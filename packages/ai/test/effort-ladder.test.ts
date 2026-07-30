import { describe, expect, it } from "bun:test";
import {
	clampThinkingLevelForModel,
	Effort,
	getBundledModel,
	getSupportedEfforts,
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

/**
 * #2630. #2346 widened the ladder to emit `xhigh` for every `opus >= 4.6`, but
 * probed only opus-5 and sonnet-5. Resuming a session pinned to
 * `claude-opus-4-6` then sent an effort that model rejects:
 *
 *   This model does not support effort level 'xhigh'.
 *   Supported levels: high, low, max, medium.
 *
 * Probed against the live gateway on 2026-07-30, with a bogus control value
 * (`ludicrous`) rejected everywhere so the accepts are meaningful:
 *
 *   model              low med high xhigh max   fallbacks
 *   claude-opus-5       Y   Y    Y     Y    Y   (none)
 *   claude-sonnet-5     Y   Y    Y     Y    Y   (none)
 *   claude-opus-4-8     Y   Y    Y     Y    Y   opus-4-6, opus-4-5
 *   claude-opus-4-6     Y   Y    Y     .    Y   opus-4-5, sonnet-4-6
 *   claude-sonnet-4-6   Y   Y    Y     .    Y   (none)
 *   claude-opus-4-5     Y   Y    Y     .    .   (none)
 *
 * The ceiling is capped to what a model group AND its fallbacks accept, because
 * the gateway re-sends an identical body on fallback rather than re-mapping per
 * target — in the original report both fallbacks 400'd on the same `xhigh`.
 * `claude-opus-4-5` accepts neither `xhigh` nor `max` and sits in both chains,
 * so opus-4-6 and opus-4-8 cap at `high` even though opus-4-8 accepts `xhigh`
 * on its own.
 */
describe("effort ceilings are capped to the model group AND its fallbacks — #2630", () => {
	for (const id of ["claude-opus-4-6", "claude-opus-4-8"]) {
		it(`${id} never emits xhigh on the wire`, () => {
			const model = anthropic(id);
			expect(getSupportedEfforts(model)).not.toContain(Effort.XHigh);
			for (const effort of THINKING_EFFORTS) {
				const wire = mapEffortToAnthropicAdaptiveEffort(
					model,
					clampThinkingLevelForModel(model, effort) ?? Effort.Low,
				);
				expect(wire).not.toBe("xhigh");
			}
		});

		it(`${id} degrades a requested xhigh to high instead of throwing`, () => {
			// This is the path the reported failure took: the session persisted an
			// effort, and `requireSupportedEffort` throws while the resolver's clamp
			// (coding-agent thinking.ts / model-resolver.ts) is what must absorb it.
			expect(clampThinkingLevelForModel(anthropic(id), Effort.XHigh)).toBe(Effort.High);
		});
	}

	it("leaves opus-5 and sonnet-5 at their full measured ceiling", () => {
		// Both have no fallback chain, so the conservative cap costs them nothing.
		for (const id of ["claude-opus-5", "claude-sonnet-5"]) {
			const model = anthropic(id);
			expect(getSupportedEfforts(model)).toContain(Effort.XHigh);
			expect(getSupportedEfforts(model)).toContain(Effort.Max);
		}
	});

	it("emits no effort outside what the probe recorded as accepted", () => {
		// Guard: a newly added adaptive model cannot inherit an unverified ceiling.
		const ACCEPTED: Record<string, readonly string[]> = {
			"claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
			"claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
			"claude-opus-4-8": ["low", "medium", "high"],
			"claude-opus-4-6": ["low", "medium", "high"],
			"claude-sonnet-4-6": ["low", "medium", "high"],
		};
		for (const [id, accepted] of Object.entries(ACCEPTED)) {
			const model = anthropic(id);
			for (const effort of getSupportedEfforts(model)) {
				expect(accepted).toContain(mapEffortToAnthropicAdaptiveEffort(model, effort));
			}
		}
	});
});

describe("other providers are unaffected", () => {
	it("Gemini wire values are unchanged", () => {
		const gemini = getBundledModel("google", "gemini-3-pro-preview");
		expect(mapEffortToGoogleThinkingLevel(gemini, Effort.Low)).toBe("LOW");
		expect(mapEffortToGoogleThinkingLevel(gemini, Effort.High)).toBe("HIGH");
	});
});
