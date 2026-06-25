import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Issue #242 — guard against silent schema drift.
 *
 * theme-schema.json (hand-maintained) and theme.ts (TypeBox) must agree
 * key-for-key. If someone flips a powerline key back to Type.Optional in
 * theme.ts without updating the JSON schema, this test fails.
 *
 * Uses source-text inspection rather than runtime introspection because
 * TypeBox's Type.Optional wrapper is erased at the type level and the
 * compiled schema object doesn't always preserve the distinction in a way
 * that is easy to assert across versions.
 */

const repoRoot = path.resolve(import.meta.dir, "../../..");
const themeTsPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/theme.ts");

const REQUIRED_POWERLINE_KEYS = [
	"chromeAccent",
	"spinnerAccent",
	"contentAccent",
	"gutterSuccess",
	"gutterWarning",
	"statusLineOsIconBg",
	"statusLineOsIconFg",
	"statusLinePathBg",
	"statusLinePathFg",
	"statusLineGitCleanBg",
	"statusLineGitCleanFg",
	"statusLineGitDirtyBg",
	"statusLineGitDirtyFg",
	"statusLineGitStagedBg",
	"statusLineGitStagedFg",
	"statusLineGitUntrackedBg",
	"statusLineGitUntrackedFg",
	"statusLineGitConflictBg",
	"statusLineGitConflictFg",
	"statusLinePlanModeBg",
	"statusLinePlanModeFg",
	"statusLineContextXcshBg",
	"statusLineContextXcshFg",
] as const;

let src: string;

describe("theme.ts TypeBox agrees with theme-schema.json (issue #242)", () => {
	beforeAll(async () => {
		src = await fs.readFile(themeTsPath, "utf8");
	});

	it("each required powerline key is declared WITHOUT Type.Optional wrapper", () => {
		const offenders: string[] = [];
		for (const key of REQUIRED_POWERLINE_KEYS) {
			// Require an exact line of the form:  <key>: ColorValueSchema,
			// Reject any line of the form:       <key>: Type.Optional(...)
			const optionalRe = new RegExp(`^\\s*${key}:\\s*Type\\.Optional\\(`, "m");
			const requiredRe = new RegExp(`^\\s*${key}:\\s*ColorValueSchema,?\\s*$`, "m");
			if (optionalRe.test(src)) {
				offenders.push(`${key}: still wrapped in Type.Optional`);
			} else if (!requiredRe.test(src)) {
				offenders.push(`${key}: not declared as ColorValueSchema on its own line`);
			}
		}
		expect(offenders, "TypeBox drift — re-run task 2 of plan 2026-04-22-theme-powerline-schema-plan.md").toEqual([]);
	});

	it("gutterError stays optional — neither theme carries it", () => {
		expect(src).toMatch(/^\s*gutterError:\s*Type\.Optional\(ColorValueSchema\),?\s*$/m);
	});

	it("statusLineGitFg is absent from theme.ts (orphan removed)", () => {
		expect(src).not.toContain("statusLineGitFg");
	});

	it("staged keys are present", () => {
		expect(src).toMatch(/^\s*statusLineGitStagedBg:\s*ColorValueSchema,?\s*$/m);
		expect(src).toMatch(/^\s*statusLineGitStagedFg:\s*ColorValueSchema,?\s*$/m);
	});

	it("TypeBox colors object rejects additional properties at runtime (matches JSON schema strictness)", () => {
		// Codex review on PR #248 flagged that theme-schema.json had `additionalProperties: false`
		// on colors but the runtime TypeBox validator did not — so loadThemeJson() would accept
		// custom themes with stray keys (e.g. leftover statusLineGitFg) even though editors
		// flagged them. Guard: the colors Type.Object must be passed `additionalProperties: false`.
		// Extract the `colors: Type.Object(...)` block up to the next top-level key `export:` and
		// assert the options flag is present — resilient to biome reformatting the call across lines.
		const colorsSection = src.match(/colors:\s*Type\.Object\(([\s\S]*?)\),\s*export:/);
		expect(colorsSection, "could not locate `colors: Type.Object(...)` block in theme.ts").not.toBeNull();
		expect(colorsSection?.[1] ?? "").toContain("additionalProperties: false");
	});
});
