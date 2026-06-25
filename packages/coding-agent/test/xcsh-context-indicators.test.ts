import { beforeAll, describe, expect, it } from "bun:test";
import { initTheme } from "../src/modes/theme/theme";
import { formatStatusIcon, type StatusCategory } from "../src/services/xcsh-context-indicators";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// The coding-agent surfaces (welcome screen + /context table) unify on checkbox-style
// emoji for at-a-glance status. We target iTerm2 + Nerd Fonts where emoji presentation
// and width are consistent. Each icon is 2 terminal cells wide (emoji-presentation).
describe("formatStatusIcon", () => {
	beforeAll(() => {
		initTheme();
	});

	it("returns ✅ for 'connected'", () => {
		expect(stripAnsi(formatStatusIcon("connected"))).toBe("✅");
	});

	it("returns ❌ for 'error'", () => {
		expect(stripAnsi(formatStatusIcon("error"))).toBe("❌");
	});

	it("returns ⚠️ for 'warning' (with VS16 emoji-presentation selector)", () => {
		expect(stripAnsi(formatStatusIcon("warning"))).toBe("⚠️");
	});

	it("returns ❓ for 'unknown'", () => {
		expect(stripAnsi(formatStatusIcon("unknown"))).toBe("❓");
	});

	it("every category produces a distinct glyph", () => {
		const categories: StatusCategory[] = ["connected", "error", "warning", "unknown"];
		const glyphs = new Set(categories.map(c => stripAnsi(formatStatusIcon(c))));
		expect(glyphs.size).toBe(4);
	});

	it("produces exactly 2 cells of visible width per icon (emoji presentation)", () => {
		const categories: StatusCategory[] = ["connected", "error", "warning", "unknown"];
		for (const cat of categories) {
			const plain = stripAnsi(formatStatusIcon(cat));
			expect(Bun.stringWidth(plain)).toBe(2);
		}
	});
});
