import { describe, expect, it } from "bun:test";
import { resolveStatusIcon } from "@f5-sales-demo/xcsh/modes/controllers/command-controller";
import { initTheme, theme } from "@f5-sales-demo/xcsh/modes/theme/theme";

describe("command-controller resolveStatusIcon", () => {
	it("returns empty string for unknown status (no inline glyph — was ⏳)", async () => {
		await initTheme();
		expect(resolveStatusIcon("unknown", theme)).toBe("");
	});

	it("emits error glyph for exhausted state", async () => {
		await initTheme();
		const out = resolveStatusIcon("exhausted", theme);
		expect(out).toContain("✘");
	});

	it("emits warning glyph for warning state", async () => {
		await initTheme();
		const out = resolveStatusIcon("warning", theme);
		expect(out).toContain("⚠");
	});

	it("emits success glyph for ok state", async () => {
		await initTheme();
		const out = resolveStatusIcon("ok", theme);
		expect(out).toContain("✔");
	});
});
