import type { Component } from "@f5-sales-demo/pi-tui";
import type { GutterBlock } from "../components/gutter-block";

type Outcome = "success" | "error";

/**
 * Aggregates per-read outcomes across a shared read-group gutter so the
 * final rendered dot reflects the worst-case outcome of the group.
 *
 * Called by two paths:
 *   • live event-controller — reads arrive one at a time during streaming;
 *     the gutter's spinner must stay active until the last read in the
 *     group completes, so finalize is called only when `stillActive` is
 *     false.
 *   • replay ui-helpers — transcript rebuild walks completed tool results
 *     in order; finalize is called at each group boundary.
 *
 * Semantics:
 *   • `record` merges an incoming outcome into the running worst-case for
 *     the gutter. "error" beats "success" regardless of ordering.
 *   • `finalize` flushes the aggregated outcome to `gutter.setDone()`,
 *     clears the entry, and returns. Calling `finalize` on a gutter that
 *     was never `record`ed calls `setDone()` with no argument so the
 *     gutter renders in its neutral done state.
 *   • `peek` is read-only — useful for assertions and instrumentation.
 */
// Gutter generic parameter is not relevant to aggregation; constrain to
// `Component` (the superclass required by GutterBlock) so callers with
// concrete child types still flow in cleanly.
type AnyGutter = GutterBlock<Component>;

export class ReadGroupOutcomeAggregator {
	#outcomes = new WeakMap<AnyGutter, Outcome>();

	record(gutter: AnyGutter, outcome: Outcome): void {
		const current = this.#outcomes.get(gutter);
		// "error" is strictly worse than "success" — once any read in the
		// group fails, the whole group is marked failed.
		if (current === "error") return;
		this.#outcomes.set(gutter, outcome);
	}

	peek(gutter: AnyGutter): Outcome | undefined {
		return this.#outcomes.get(gutter);
	}

	finalize(gutter: AnyGutter): void {
		const outcome = this.#outcomes.get(gutter);
		this.#outcomes.delete(gutter);
		gutter.setDone(outcome);
	}
}

// Re-export for callers that need the generic gutter type alias.
export type { AnyGutter as ReadGroupGutter, Outcome as ReadGroupOutcome };
