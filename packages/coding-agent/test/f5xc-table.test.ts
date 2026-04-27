import { beforeAll, describe, expect, it } from "bun:test";
import { initTheme } from "../src/modes/theme/theme";
import { formatStatusIcon } from "../src/services/f5xc-context-indicators";
import { formatAuthIndicator, formatRotation, renderF5XCTable } from "../src/services/f5xc-table";

const vw = (s: string) => (s ? Bun.stringWidth(s) : 0);
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("formatAuthIndicator (unified emoji indicators)", () => {
	beforeAll(() => {
		initTheme();
	});

	it("connected uses the shared ✅ glyph", () => {
		const out = formatAuthIndicator("connected", 42);
		expect(stripAnsi(out)).toContain("✅");
		expect(stripAnsi(out)).toContain("Connected");
		expect(stripAnsi(out)).toContain("(42ms)");
	});

	it("auth_error uses the shared ❌ glyph", () => {
		const out = formatAuthIndicator("auth_error");
		expect(stripAnsi(out)).toContain("❌");
		expect(stripAnsi(out)).toContain("Auth Error");
	});

	it("offline uses the shared ⚠️ glyph", () => {
		const out = formatAuthIndicator("offline");
		expect(stripAnsi(out)).toContain("⚠️");
		expect(stripAnsi(out)).toContain("Offline");
	});

	it("unknown uses the shared ❓ glyph", () => {
		const out = formatAuthIndicator("unknown");
		expect(stripAnsi(out)).toContain("❓");
	});

	it("connected glyph matches formatStatusIcon('connected')", () => {
		expect(formatAuthIndicator("connected").startsWith(formatStatusIcon("connected"))).toBe(true);
	});

	it("offline glyph matches formatStatusIcon('warning')", () => {
		expect(formatAuthIndicator("offline").startsWith(formatStatusIcon("warning"))).toBe(true);
	});
});

describe("renderF5XCTable", () => {
	it("all lines have equal visible width", () => {
		const rows = [
			{ key: "F5XC_TENANT", value: "my-org" },
			{ key: "F5XC_API_URL", value: "https://my-org.console.ves.volterra.io" },
			{ key: "Status", value: "\x1b[38;5;34m\u25CF\x1b[0m Connected (42ms)" },
		];
		const output = renderF5XCTable("test-context", rows);
		const lines = output.split("\n");
		const widths = lines.map(l => vw(l));
		expect(new Set(widths).size).toBe(1);
	});

	it("respects minimum inner width of 40", () => {
		const rows = [{ key: "A", value: "B" }];
		const output = renderF5XCTable("x", rows);
		const firstLine = output.split("\n")[0];
		// 40 inner chars + 2 border chars = 42 minimum visible width
		expect(vw(firstLine)).toBeGreaterThanOrEqual(42);
	});

	it("handles ANSI-colored values without misalignment", () => {
		const coloredValue = "\x1b[32m\u25CF Connected (100ms)\x1b[0m";
		const rows = [
			{ key: "Key", value: coloredValue },
			{ key: "Other", value: "plain text" },
		];
		const output = renderF5XCTable("title", rows);
		const lines = output.split("\n");
		const widths = lines.map(l => vw(l));
		expect(new Set(widths).size).toBe(1);
	});

	it("renders consistent widths with divider section", () => {
		const rows = [
			{ key: "F5XC_TENANT", value: "myorg" },
			{ key: "Status", value: formatAuthIndicator("connected", 55) },
			{ key: "F5XC_NAMESPACE", value: "default" },
			{ key: "F5XC_CUSTOM_VAR", value: "some-value" },
		];
		const output = renderF5XCTable("myorg", rows, { dividers: [{ before: 2, label: "Environment" }] });
		const lines = output.split("\n");
		const widths = lines.map(l => vw(l));
		expect(new Set(widths).size).toBe(1);
	});

	it("handles long URLs without clipping the right border", () => {
		const rows = [
			{ key: "F5XC_API_URL", value: "https://very-long-tenant-name.console.ves.volterra.io/api" },
			{ key: "F5XC_NAMESPACE", value: "default" },
		];
		const output = renderF5XCTable("long-tenant", rows);
		const lines = output.split("\n");
		const widths = lines.map(l => vw(l));
		expect(new Set(widths).size).toBe(1);
	});
});

describe("formatRotation", () => {
	const now = new Date("2026-04-27T12:00:00.000Z");

	it("shows plain text when no lastRotatedAt", () => {
		expect(formatRotation(30, undefined, now)).toBe("every 30 days");
	});

	it("shows plain text when rotation not due", () => {
		expect(formatRotation(30, "2026-04-22T12:00:00.000Z", now)).toBe("every 30 days");
	});

	it("shows due-soon warning within 7 days of threshold", () => {
		const result = formatRotation(30, "2026-03-31T12:00:00.000Z", now);
		expect(result).toContain("every 30 days");
		expect(result).toContain("rotation due in");
	});

	it("shows overdue warning when past threshold", () => {
		const result = formatRotation(30, "2026-02-26T12:00:00.000Z", now);
		expect(result).toContain("every 30 days");
		expect(result).toContain("overdue by");
	});
});
