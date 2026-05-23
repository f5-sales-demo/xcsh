import { beforeAll, describe, expect, it } from "bun:test";
import { initTheme } from "../src/modes/theme/theme";
import type { ContextStatus } from "../src/services/f5xc-context";
import { truncateContextLabel } from "../src/services/f5xc-context-display";

beforeAll(async () => {
	await initTheme();
});

describe("status-line types", () => {
	it("PresetDef accepts dropOrder field", async () => {
		const { STATUS_LINE_PRESETS } = await import("../src/modes/components/status-line/presets");
		const xcsh = STATUS_LINE_PRESETS.xcsh;
		expect(xcsh.dropOrder).toBeDefined();
		expect(Array.isArray(xcsh.dropOrder)).toBe(true);
	});

	it("StatusLineSegment accepts truncate method", async () => {
		const { SEGMENTS } = await import("../src/modes/components/status-line/segments");
		const f5xcSegment = SEGMENTS.context_f5xc;
		expect(typeof f5xcSegment.truncate).toBe("function");
	});
});

function makeStatus(overrides: Partial<ContextStatus> = {}): ContextStatus {
	return {
		activeContextName: "test-context",
		activeContextUrl: "https://example.console.ves.volterra.io/api",
		activeContextTenant: "nferreira",
		activeContextNamespace: "r-mordasiewicz",
		credentialSource: "context",
		authStatus: "valid",
		isConfigured: true,
		tokenHealth: "ok",
		...overrides,
	} as ContextStatus;
}

describe("truncateContextLabel", () => {
	it("returns full label when maxWidth is large enough", () => {
		const result = truncateContextLabel(makeStatus(), 30);
		expect(result).toBe("nferreira:r-mordasiewicz");
	});

	it("truncates namespace with ellipsis when width is 15-24", () => {
		const result = truncateContextLabel(makeStatus(), 18);
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(18);
		expect(result!).toMatch(/^nferreira:.*…$/);
	});

	it("abbreviates both sides when width is 8-14", () => {
		const result = truncateContextLabel(makeStatus(), 10);
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(10);
		expect(result!).toContain(":");
	});

	it("shows tenant abbreviation only when width is 4-7", () => {
		const result = truncateContextLabel(makeStatus(), 5);
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(5);
		expect(result!).toMatch(/^.+:…$/);
	});

	it("returns null when width is less than 4", () => {
		const result = truncateContextLabel(makeStatus(), 3);
		expect(result).toBeNull();
	});

	it("preserves warning indicator and subtracts its width", () => {
		const status = makeStatus({ tokenHealth: "expiring" });
		const result = truncateContextLabel(status, 15);
		expect(result).not.toBeNull();
		expect(result!).toContain("⚠");
		expect(result!.length).toBeLessThanOrEqual(15);
	});

	it("returns null for unconfigured status", () => {
		const status = makeStatus({ isConfigured: false });
		const result = truncateContextLabel(status, 30);
		expect(result).toBeNull();
	});
});

describe("preset dropOrder", () => {
	it("all non-custom presets define dropOrder", async () => {
		const { STATUS_LINE_PRESETS } = await import("../src/modes/components/status-line/presets");
		for (const [name, preset] of Object.entries(STATUS_LINE_PRESETS)) {
			if (name === "custom") {
				expect(preset.dropOrder).toBeUndefined();
				continue;
			}
			expect(preset.dropOrder).toBeDefined();
			expect(Array.isArray(preset.dropOrder)).toBe(true);
			expect(preset.dropOrder!.length).toBeGreaterThan(0);
		}
	});

	it("xcsh dropOrder has context_f5xc as highest priority (last element)", async () => {
		const { STATUS_LINE_PRESETS } = await import("../src/modes/components/status-line/presets");
		const xcsh = STATUS_LINE_PRESETS.xcsh;
		expect(xcsh.dropOrder![xcsh.dropOrder!.length - 1]).toBe("context_f5xc");
	});

	it("dropOrder entries are a subset of leftSegments + rightSegments", async () => {
		const { STATUS_LINE_PRESETS } = await import("../src/modes/components/status-line/presets");
		for (const [name, preset] of Object.entries(STATUS_LINE_PRESETS)) {
			if (name === "custom" || !preset.dropOrder) continue;
			const allSegments = new Set([...preset.leftSegments, ...preset.rightSegments]);
			for (const id of preset.dropOrder) {
				expect(allSegments.has(id)).toBe(true);
			}
		}
	});
});
