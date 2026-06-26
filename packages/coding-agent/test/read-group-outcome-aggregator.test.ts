import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { Component, TUI } from "@f5-sales-demo/pi-tui";
import { createToolGutter, type GutterBlock } from "../src/modes/components/gutter-block";
import { initTheme } from "../src/modes/theme/theme";
import { ReadGroupOutcomeAggregator } from "../src/modes/utils/read-group-outcome-aggregator";

beforeAll(async () => {
	await initTheme();
});

const mockTUI = (): TUI => ({ requestRender: vi.fn() }) as unknown as TUI;
const stub = (lines: string[]): Component => ({
	render: () => [...lines],
	invalidate: vi.fn(),
});

// Build a tool gutter that records which outcome `setDone` was ultimately
// called with — the aggregator's only observable effect on a gutter.
function makeTrackedGutter(): { gutter: GutterBlock<Component>; calls: Array<"success" | "error" | undefined> } {
	const calls: Array<"success" | "error" | undefined> = [];
	const gutter = createToolGutter(mockTUI(), stub(["x"]));
	const originalSetDone = gutter.setDone.bind(gutter);
	gutter.setDone = (outcome?: "success" | "error") => {
		calls.push(outcome);
		originalSetDone(outcome);
	};
	return { gutter, calls };
}

describe("ReadGroupOutcomeAggregator", () => {
	it('finalize with only success records calls setDone("success")', () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		agg.record(gutter, "success");
		agg.finalize(gutter);

		expect(calls).toEqual(["success"]);
	});

	it('finalize with only error records calls setDone("error")', () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		agg.record(gutter, "error");
		agg.finalize(gutter);

		expect(calls).toEqual(["error"]);
	});

	it("error wins after success (success→error ordering)", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		agg.record(gutter, "success");
		agg.record(gutter, "error");
		agg.finalize(gutter);

		expect(calls).toEqual(["error"]);
	});

	it("error wins after success (error→success ordering)", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		agg.record(gutter, "error");
		agg.record(gutter, "success");
		agg.finalize(gutter);

		expect(calls).toEqual(["error"]);
	});

	it("finalize without any record calls setDone() with undefined outcome", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		agg.finalize(gutter);

		expect(calls).toEqual([undefined]);
	});

	it("peek reveals the running worst-case outcome without finalizing", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		expect(agg.peek(gutter)).toBeUndefined();
		agg.record(gutter, "success");
		expect(agg.peek(gutter)).toBe("success");
		agg.record(gutter, "error");
		expect(agg.peek(gutter)).toBe("error");
		// peek is read-only: still no setDone
		expect(calls).toEqual([]);
	});

	it("tracks multiple gutters independently", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const a = makeTrackedGutter();
		const b = makeTrackedGutter();

		agg.record(a.gutter, "success");
		agg.record(b.gutter, "error");
		agg.finalize(a.gutter);
		agg.finalize(b.gutter);

		expect(a.calls).toEqual(["success"]);
		expect(b.calls).toEqual(["error"]);
	});

	it("finalize clears the tracked outcome so a gutter can be reused", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();

		agg.record(gutter, "error");
		agg.finalize(gutter);
		// After finalize, the record is gone — peek returns undefined again.
		expect(agg.peek(gutter)).toBeUndefined();
		// Finalizing the same gutter a second time uses the fresh (empty) state.
		agg.finalize(gutter);
		// Second finalize adds another bare setDone() call (idempotent at the gutter level).
		expect(calls).toEqual(["error", undefined]);
	});
});

// ---------------------------------------------------------------------------
// Integration scenarios — rehearse the exact control flow of both call sites.
// ---------------------------------------------------------------------------

describe("ReadGroupOutcomeAggregator — call-site scenarios", () => {
	/**
	 * Mirrors `EventController.#cleanupReadGutter`. The live path keeps the
	 * group gutter's spinner active while any read in the group is still
	 * pending, then finalizes with the worst outcome once the last read
	 * completes.
	 */
	function simulateLiveCleanup(
		agg: ReadGroupOutcomeAggregator,
		gutter: GutterBlock<Component>,
		pendingGutters: Map<string, GutterBlock<Component>>,
		toolCallId: string,
		outcome: "success" | "error",
	): void {
		pendingGutters.delete(toolCallId);
		agg.record(gutter, outcome);
		const stillActive = Array.from(pendingGutters.values()).some(g => g === gutter);
		if (!stillActive) {
			agg.finalize(gutter);
		}
	}

	it("live: two reads sharing one group — first success, second error → final error", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();
		const pending = new Map<string, GutterBlock<Component>>([
			["r1", gutter],
			["r2", gutter],
		]);

		// First read completes successfully; r2 still pending → no finalize
		simulateLiveCleanup(agg, gutter, pending, "r1", "success");
		expect(calls).toEqual([]);

		// Second read fails → finalize
		simulateLiveCleanup(agg, gutter, pending, "r2", "error");
		expect(calls).toEqual(["error"]);
	});

	it("live: two reads sharing one group — first error, second success → final error", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const { gutter, calls } = makeTrackedGutter();
		const pending = new Map<string, GutterBlock<Component>>([
			["r1", gutter],
			["r2", gutter],
		]);

		simulateLiveCleanup(agg, gutter, pending, "r1", "error");
		expect(calls).toEqual([]);
		simulateLiveCleanup(agg, gutter, pending, "r2", "success");
		expect(calls).toEqual(["error"]);
	});

	it("live: two independent groups — one fails, one succeeds — finalize independently", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const groupA = makeTrackedGutter();
		const groupB = makeTrackedGutter();
		const pending = new Map<string, GutterBlock<Component>>([
			["a1", groupA.gutter],
			["b1", groupB.gutter],
		]);

		simulateLiveCleanup(agg, groupA.gutter, pending, "a1", "error");
		simulateLiveCleanup(agg, groupB.gutter, pending, "b1", "success");
		expect(groupA.calls).toEqual(["error"]);
		expect(groupB.calls).toEqual(["success"]);
	});

	/**
	 * Mirrors `UiHelpers.loadConversation` replay flow. Each read result is
	 * recorded into the aggregator, and the group is finalized at group
	 * boundaries (non-read tool call, new assistant message, end of loop).
	 */
	it("replay: sequential reads across two groups separated by a boundary", () => {
		const agg = new ReadGroupOutcomeAggregator();
		const groupA = makeTrackedGutter();
		const groupB = makeTrackedGutter();

		// Group A — mixed outcomes
		agg.record(groupA.gutter, "success");
		agg.record(groupA.gutter, "error");
		agg.record(groupA.gutter, "success");

		// Boundary: non-read tool call arrives, finalize group A
		agg.finalize(groupA.gutter);

		// Group B — all success
		agg.record(groupB.gutter, "success");
		agg.record(groupB.gutter, "success");

		// End of loop: finalize group B
		agg.finalize(groupB.gutter);

		expect(groupA.calls).toEqual(["error"]);
		expect(groupB.calls).toEqual(["success"]);
	});
});
