import { describe, expect, it } from "bun:test";
import { initTheme, theme } from "@f5-sales-demo/xcsh/modes/theme/theme";
import { formatStatusIcon } from "@f5-sales-demo/xcsh/tools/render-utils";

describe("formatStatusIcon", () => {
	it("returns empty string for pending (gutter ball is the spinner)", async () => {
		await initTheme();
		expect(formatStatusIcon("pending", theme)).toBe("");
	});

	it("emits success glyph ✔ for success state", async () => {
		await initTheme();
		const out = formatStatusIcon("success", theme);
		expect(out).toContain("✔");
	});

	it("emits error glyph ✘ for error state", async () => {
		await initTheme();
		const out = formatStatusIcon("error", theme);
		expect(out).toContain("✘");
	});

	it("emits warning glyph ⚠ for warning state", async () => {
		await initTheme();
		const out = formatStatusIcon("warning", theme);
		expect(out).toContain("⚠");
	});
});
