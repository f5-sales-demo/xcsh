import { beforeAll, describe, expect, it } from "bun:test";
import { initTheme } from "../src/modes/theme/theme";
import { formatStatusIcon, type StatusCategory } from "../src/services/f5xc-profile-indicators";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatStatusIcon", () => {
	beforeAll(() => {
		initTheme();
	});

	it("returns a filled circle for 'connected'", () => {
		expect(stripAnsi(formatStatusIcon("connected"))).toBe("●");
	});

	it("returns an empty circle for 'error'", () => {
		expect(stripAnsi(formatStatusIcon("error"))).toBe("○");
	});

	it("returns a warning triangle for 'warning'", () => {
		expect(stripAnsi(formatStatusIcon("warning"))).toBe("⚠");
	});

	it("returns an empty circle for 'unknown'", () => {
		expect(stripAnsi(formatStatusIcon("unknown"))).toBe("○");
	});

	it("wraps the glyph in ANSI color escapes (success for connected)", () => {
		const out = formatStatusIcon("connected");
		expect(out).not.toBe(stripAnsi(out));
		expect(out).toContain("\x1b[");
	});

	it("applies distinct colors for distinct categories", () => {
		const connectedColored = formatStatusIcon("connected");
		const errorColored = formatStatusIcon("error");
		const warningColored = formatStatusIcon("warning");
		const unknownColored = formatStatusIcon("unknown");
		// All four categories must produce visually distinct ANSI output.
		const set = new Set([connectedColored, errorColored, warningColored, unknownColored]);
		expect(set.size).toBe(4);
	});

	it("produces exactly 1 cell of visible width per icon (column alignment)", () => {
		const categories: StatusCategory[] = ["connected", "error", "warning", "unknown"];
		for (const cat of categories) {
			const plain = stripAnsi(formatStatusIcon(cat));
			expect(Bun.stringWidth(plain)).toBe(1);
		}
	});
});
