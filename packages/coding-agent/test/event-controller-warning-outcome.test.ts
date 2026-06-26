import { describe, expect, it, vi } from "bun:test";
import type { Component, TUI } from "@f5-sales-demo/pi-tui";
import { GutterBlock } from "../src/modes/components/gutter-block";
import { initTheme } from "../src/modes/theme/theme";

function mockTUI(): TUI {
	return { requestRender: vi.fn() } as unknown as TUI;
}

function stubComponent(): Component {
	return { render: () => ["body"], invalidate: vi.fn() } as unknown as Component;
}

function trackedGutter() {
	const ui = mockTUI();
	const calls: Array<string | undefined> = [];
	const gutter = new GutterBlock(ui, stubComponent(), {
		symbol: "●",
		activeColorFn: s => s,
		doneColorFn: s => s,
		animated: false,
	});
	const originalSetDone = gutter.setDone.bind(gutter);
	gutter.setDone = ((outcome?: "success" | "error" | "warning") => {
		calls.push(outcome);
		originalSetDone(outcome);
	}) as typeof gutter.setDone;
	return { gutter, calls };
}

// Mirror the three-way mapping the event controller applies at the
// tool_execution_end site (L~444 in event-controller.ts) and the
// async-final site (L~376). If the mapping drifts, the UI outcome
// will silently diverge from the tool-emitted signal.
function mapOutcome(event: { isError?: boolean; isWarning?: boolean }) {
	return event.isError ? "error" : event.isWarning ? "warning" : "success";
}

describe("event-controller tool_execution_end outcome mapping", () => {
	it("isError=true dominates isWarning", () => {
		expect(mapOutcome({ isError: true, isWarning: true })).toBe("error");
		expect(mapOutcome({ isError: true, isWarning: false })).toBe("error");
	});

	it("isWarning=true maps to 'warning' when isError is false/undefined", () => {
		expect(mapOutcome({ isError: false, isWarning: true })).toBe("warning");
		expect(mapOutcome({ isWarning: true })).toBe("warning");
	});

	it("defaults to 'success' when both flags are false/undefined", () => {
		expect(mapOutcome({})).toBe("success");
		expect(mapOutcome({ isError: false, isWarning: false })).toBe("success");
	});

	it("setDone receives 'warning' when the mapped outcome is warning", async () => {
		await initTheme();
		const { gutter, calls } = trackedGutter();
		gutter.setDone(mapOutcome({ isError: false, isWarning: true }) as "warning");
		expect(calls).toEqual(["warning"]);
	});
});
