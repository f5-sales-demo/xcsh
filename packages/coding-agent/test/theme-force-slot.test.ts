/**
 * Issue #228 — theme.forceSlot setting overrides auto dark/light detection.
 *
 * Pure-function test for the slot-resolution helper. Unit-testable without
 * a terminal so CI runs deterministically.
 */
import { describe, expect, it } from "bun:test";
import { resolveThemeSlot } from "@f5-sales-demo/xcsh/modes/theme/theme";

describe("resolveThemeSlot — theme.forceSlot override (issue #228)", () => {
	it("returns the dark theme when forceSlot=dark, regardless of detection", () => {
		expect(resolveThemeSlot("dark", "light", "xcsh-dark", "xcsh-light")).toBe("xcsh-dark");
		expect(resolveThemeSlot("dark", "dark", "xcsh-dark", "xcsh-light")).toBe("xcsh-dark");
	});

	it("returns the light theme when forceSlot=light, regardless of detection", () => {
		expect(resolveThemeSlot("light", "dark", "xcsh-dark", "xcsh-light")).toBe("xcsh-light");
		expect(resolveThemeSlot("light", "light", "xcsh-dark", "xcsh-light")).toBe("xcsh-light");
	});

	it("falls through to detection when forceSlot=auto (default)", () => {
		expect(resolveThemeSlot("auto", "dark", "xcsh-dark", "xcsh-light")).toBe("xcsh-dark");
		expect(resolveThemeSlot("auto", "light", "xcsh-dark", "xcsh-light")).toBe("xcsh-light");
	});

	it("respects custom slot theme names (not hardcoded to xcsh-*)", () => {
		expect(resolveThemeSlot("dark", "light", "my-dark-theme", "my-light-theme")).toBe("my-dark-theme");
		expect(resolveThemeSlot("light", "dark", "my-dark-theme", "my-light-theme")).toBe("my-light-theme");
		expect(resolveThemeSlot("auto", "dark", "my-dark-theme", "my-light-theme")).toBe("my-dark-theme");
	});
});
