/**
 * Issue #221 — Dark/Light Theme rows in /settings must indicate which slot is
 * the currently-loaded theme. The displayed value gains an "(active)" suffix
 * on the matching row.
 *
 * The formatting is extracted to a pure helper `formatSubmenuCurrentValue` so
 * it's testable without standing up the full TUI.
 */
import { describe, expect, it } from "bun:test";
import { formatSubmenuCurrentValue } from "@f5-sales-demo/xcsh/modes/components/settings-selector";

describe("formatSubmenuCurrentValue — active-theme indicator (issue #221)", () => {
	it("appends '(active)' to theme.dark row value when it matches currentThemeName", () => {
		expect(formatSubmenuCurrentValue("theme.dark", "xcsh-dark", "xcsh-dark")).toBe("xcsh-dark (active)");
	});

	it("appends '(active)' to theme.light row value when it matches currentThemeName", () => {
		expect(formatSubmenuCurrentValue("theme.light", "xcsh-light", "xcsh-light")).toBe("xcsh-light (active)");
	});

	it("does not mark the dark slot active when xcsh-light is currently loaded", () => {
		expect(formatSubmenuCurrentValue("theme.dark", "xcsh-dark", "xcsh-light")).toBe("xcsh-dark");
	});

	it("does not mark the light slot active when xcsh-dark is currently loaded", () => {
		expect(formatSubmenuCurrentValue("theme.light", "xcsh-light", "xcsh-dark")).toBe("xcsh-light");
	});

	it("returns plain value when no currentThemeName is known (undefined)", () => {
		expect(formatSubmenuCurrentValue("theme.dark", "xcsh-dark", undefined)).toBe("xcsh-dark");
	});

	it("preserves 'default' mapping for compaction.thresholdPercent -1 (existing behavior)", () => {
		expect(formatSubmenuCurrentValue("compaction.thresholdPercent", "-1", "xcsh-dark")).toBe("default");
		expect(formatSubmenuCurrentValue("compaction.thresholdPercent", "", "xcsh-dark")).toBe("default");
	});

	it("preserves 'default' mapping for compaction.thresholdTokens -1 (existing behavior)", () => {
		expect(formatSubmenuCurrentValue("compaction.thresholdTokens", "-1", "xcsh-dark")).toBe("default");
		expect(formatSubmenuCurrentValue("compaction.thresholdTokens", "", "xcsh-dark")).toBe("default");
	});

	it("returns plain value for unrelated submenu paths (no active marker)", () => {
		expect(formatSubmenuCurrentValue("statusLine.preset", "xcsh", "xcsh-dark")).toBe("xcsh");
	});

	it("does not mark active when the selected row is a DIFFERENT theme than the current", () => {
		// e.g., user has xcsh-light loaded but they highlight the dark slot which is xcsh-dark
		expect(formatSubmenuCurrentValue("theme.dark", "xcsh-dark", "xcsh-light")).not.toContain("(active)");
	});
});
