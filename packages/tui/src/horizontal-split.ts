import type { Component } from "./tui";
import { padding, sliceByColumn, visibleWidth } from "./utils";

const RESET_SGR = "\x1b[0m";

/** Width configuration for a single HorizontalSplit child. */
export type SplitChildWidth = { kind: "fixed"; value: number } | { kind: "flex"; value: number; minWidth?: number };

/** One child placed in a HorizontalSplit, with width + priority metadata. */
export interface SplitChild {
	component: Component;
	width: SplitChildWidth;
	/** Lower priority collapses first when the terminal is too narrow to satisfy all flex minimums. */
	priority: number;
}

/**
 * Side-by-side layout primitive.
 *
 * Implements `Component` directly (not a Container subclass) because each
 * child carries width/priority metadata that doesn't fit the plain
 * `Component[]` model of `Container`. API surface matches spec §6.1:
 * `render(width)` returns the composed rows.
 *
 * Width allocation (spec §6.1):
 * 1. Subtract separator cost (N-1 columns for N children).
 * 2. Allocate fixed-width children first.
 * 3. Distribute remaining columns across flex children proportionally
 *    by `flex.value`.
 * 4. If any flex child falls below its `minWidth`: drop the lowest-priority
 *    child (binary collapse — not fractional shrink) and retry.
 * 5. If all minimums still unsatisfiable: expand the highest-priority flex
 *    child to consume everything; no separators rendered.
 *
 * Line composition (spec §6.1):
 * - row count = max(child.render(w).length)
 * - each row: per-child slice-or-pad to its allocated width, joined by
 *   the separator character, terminated with `\x1b[0m`.
 */
export class HorizontalSplit implements Component {
	readonly #children: SplitChild[];
	readonly #separator: string;

	constructor(children: SplitChild[], separator: string = " ") {
		this.#children = children;
		this.#separator = separator;
	}

	invalidate(): void {
		for (const c of this.#children) c.component.invalidate?.();
	}

	render(totalWidth: number): string[] {
		const widths = this.#allocate(Math.max(1, totalWidth));
		return this.#compose(widths);
	}

	/**
	 * Allocate per-child widths. Fixed children get their configured value;
	 * flex children split the remainder proportionally. Collapsed children
	 * receive 0. Separator columns (widths.separatorCount) are accounted for.
	 *
	 * Task 5 adds binary collapse: when a flex child's minWidth is unmet, the
	 * lowest-priority active child is dropped to zero and allocation is retried.
	 * Task 6 adds the final fallback when nothing can be dropped.
	 */
	#allocate(totalWidth: number): number[] {
		return this.#allocateWithActive(
			totalWidth,
			this.#children.map((_, i) => i),
		);
	}

	#allocateWithActive(totalWidth: number, activeIndices: number[]): number[] {
		const n = this.#children.length;
		const widths = new Array<number>(n).fill(0);
		if (activeIndices.length === 0) return widths;

		const separatorCost = Math.max(0, activeIndices.length - 1);
		let remaining = totalWidth - separatorCost;

		// Fixed pass for active children only
		for (const i of activeIndices) {
			const child = this.#children[i]!;
			if (child.width.kind === "fixed") {
				widths[i] = Math.min(child.width.value, Math.max(0, remaining));
				remaining -= widths[i]!;
			}
		}

		// Flex pass
		const flexIndices = activeIndices.filter(i => this.#children[i]!.width.kind === "flex");
		let totalFlex = 0;
		for (const i of flexIndices) {
			totalFlex += (this.#children[i]!.width as { value: number }).value;
		}
		if (flexIndices.length > 0 && totalFlex > 0) {
			let distributed = 0;
			for (let k = 0; k < flexIndices.length - 1; k++) {
				const i = flexIndices[k]!;
				const flex = (this.#children[i]!.width as { value: number }).value;
				widths[i] = Math.floor((remaining * flex) / totalFlex);
				distributed += widths[i]!;
			}
			const last = flexIndices[flexIndices.length - 1]!;
			widths[last] = Math.max(0, remaining - distributed);
		} else if (flexIndices.length > 0) {
			// All flex values sum to 0 — distribute evenly or give to first.
			// Spec doesn't hit this normally; give all remaining to first flex child.
			widths[flexIndices[0]!] = Math.max(0, remaining);
		}

		// minWidth validation — if violations, drop lowest-priority violator and retry.
		const violators: number[] = [];
		for (const i of flexIndices) {
			const spec = this.#children[i]!.width as { kind: "flex"; value: number; minWidth?: number };
			if (spec.minWidth !== undefined && widths[i]! < spec.minWidth) {
				violators.push(i);
			}
		}
		if (violators.length === 0) return widths;

		// Find lowest-priority active child.
		const activeByPriority = [...activeIndices].sort(
			(a, b) => this.#children[a]!.priority - this.#children[b]!.priority,
		);
		const drop = activeByPriority[0]!;
		const nextActive = activeIndices.filter(i => i !== drop);
		if (nextActive.length === 0) {
			// Terminal fallback: expand the highest-priority child of the ORIGINAL
			// child set to consume everything. No separators (only one active child).
			const byPriority = [...this.#children.keys()].sort(
				(a, b) => this.#children[b]!.priority - this.#children[a]!.priority,
			);
			const winner = byPriority[0]!;
			const fallback = new Array<number>(n).fill(0);
			fallback[winner] = Math.max(1, totalWidth);
			return fallback;
		}
		return this.#allocateWithActive(totalWidth, nextActive);
	}

	#compose(widths: number[]): string[] {
		const visibleIdx = widths.map((w, i) => (w > 0 ? i : -1)).filter(i => i >= 0);
		if (visibleIdx.length === 0) return [];

		const perChildLines = visibleIdx.map(i => this.#children[i]!.component.render(widths[i]!));
		const rowCount = perChildLines.reduce((m, l) => Math.max(m, l.length), 0);

		const rows: string[] = [];
		for (let r = 0; r < rowCount; r++) {
			const parts: string[] = [];
			for (let v = 0; v < visibleIdx.length; v++) {
				const childWidth = widths[visibleIdx[v]!]!;
				const raw = perChildLines[v]![r] ?? "";
				parts.push(padOrSliceToWidth(raw, childWidth));
			}
			rows.push(parts.join(this.#separator) + RESET_SGR);
		}
		return rows;
	}
}

/**
 * Pad `line` to exactly `width` visible columns, slicing if longer.
 * Uses the existing ANSI-aware helpers from `utils.ts` so SGR state is
 * preserved (and any open SGR is closed) at the slice boundary.
 */
function padOrSliceToWidth(line: string, width: number): string {
	if (width <= 0) return "";
	const visible = visibleWidth(line);
	if (visible === width) return line;
	if (visible > width) return sliceByColumn(line, 0, width);
	return line + padding(width - visible);
}
