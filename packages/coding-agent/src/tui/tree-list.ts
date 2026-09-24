/**
 * Hierarchical tree list rendering helper.
 */

import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { replaceTabs, sliceWithWidth, visibleWidth, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import type { Theme } from "../modes/theme/theme";
import { formatMoreItems } from "../tools/render-utils";
import type { TreeContext } from "./types";
import { getTreeBranch, getTreeContinuePrefix } from "./utils";

/** Wrap a structured transcript row while keeping its tree rail on every line. */
export function renderStructuredRow(
	content: string,
	firstPrefix: string,
	continuationPrefix: string,
	width: number,
): string[] {
	const normalized = replaceTabs(content);
	const firstWidth = visibleWidth(firstPrefix);
	const continuationWidth = visibleWidth(continuationPrefix);
	const available = Math.max(1, width - Math.max(firstWidth, continuationWidth));
	const wrapped = normalized ? wrapTextWithAnsi(normalized, available) : [""];
	return wrapped.map((line, index) => `${index === 0 ? firstPrefix : continuationPrefix}${line}`);
}

/** Wrap an existing tree row without discarding ANSI styling in its prefix. */
export function renderStructuredTreeLine(line: string, width: number): string[] {
	const prefix = sanitizeText(line).match(/^[ │├└╰─]*/)?.[0] ?? "";
	const prefixWidth = prefix.length;
	const firstPrefix = sliceWithWidth(line, 0, prefixWidth, true).text;
	const content = sliceWithWidth(line, prefixWidth, Math.max(0, visibleWidth(line) - prefixWidth), true).text;
	const continuationPrefix = prefix.replaceAll("├", "│").replaceAll(/[└╰─]/g, " ");
	return renderStructuredRow(content, firstPrefix, continuationPrefix, width);
}

export interface TreeListOptions<T> {
	items: T[];
	expanded?: boolean;
	maxCollapsed?: number;
	/** Strict total-line budget for collapsed mode. When set (and not expanded),
	 *  rendered item lines plus the trailing summary line must fit within this budget.
	 */
	maxCollapsedLines?: number;
	itemType?: string;
	/** Available terminal columns when list rows should wrap with their tree rails. */
	viewportWidth?: number;
	/** Called once per item with `isLast: false` during budget calculation;
	 *  line count MUST NOT vary based on `isLast`. */
	renderItem: (item: T, context: TreeContext) => string | string[];
}

export function renderTreeList<T>(options: TreeListOptions<T>, theme: Theme): string[] {
	const {
		items,
		expanded = false,
		maxCollapsed = 8,
		maxCollapsedLines,
		itemType = "item",
		renderItem,
		viewportWidth,
	} = options;
	const maxItems = expanded ? items.length : Math.min(items.length, maxCollapsed);
	const linesBudget = !expanded && maxCollapsedLines !== undefined ? maxCollapsedLines : Infinity;

	// Pre-render each candidate item once.
	// isLast cannot be known at this point (fittingCount is not yet determined);
	// renderItem implementations MUST NOT vary line count based on isLast.
	const preRendered: string[][] = [];
	for (let i = 0; i < maxItems; i++) {
		const rendered = renderItem(items[i], {
			index: i,
			isLast: false,
			depth: 0,
			theme,
			prefix: "",
			continuePrefix: "",
		});
		preRendered.push(Array.isArray(rendered) ? rendered : rendered ? [rendered] : []);
	}

	// Determine how many items fit within the line budget.
	let fittingCount = maxItems;
	let fittedLineCount = 0;
	if (linesBudget !== Infinity) {
		fittingCount = 0;
		for (let i = 0; i < maxItems; i++) {
			const count =
				viewportWidth === undefined
					? preRendered[i]!.length
					: preRendered[i]!.reduce(
							(total, line) => total + renderStructuredRow(line, "├─ ", "│  ", viewportWidth).length,
							0,
						);
			const remainingAfter = items.length - (i + 1);
			const reservedSummaryLines = remainingAfter > 0 ? 1 : 0;
			if (fittedLineCount + count + reservedSummaryLines > linesBudget) break;
			fittedLineCount += count;
			fittingCount = i + 1;
		}
	}

	const remaining = items.length - fittingCount;
	const hasSummary = !expanded && remaining > 0 && (linesBudget === Infinity || fittedLineCount < linesBudget);

	// Emit pre-rendered content with correct isLast-based branch prefixes.
	const lines: string[] = [];
	for (let i = 0; i < fittingCount; i++) {
		const isLast = !hasSummary && i === fittingCount - 1;
		const branch = getTreeBranch(isLast, theme);
		const prefix = `${theme.fg("dim", branch)} `;
		const continuePrefix = `${theme.fg("dim", getTreeContinuePrefix(isLast, theme))}`;
		const itemLines = preRendered[i]!;
		if (itemLines.length === 0) continue;
		if (viewportWidth === undefined) lines.push(`${prefix}${replaceTabs(itemLines[0]!)}`);
		else lines.push(...renderStructuredRow(itemLines[0]!, prefix, continuePrefix, viewportWidth));
		for (let j = 1; j < itemLines.length; j++) {
			if (viewportWidth === undefined) lines.push(`${continuePrefix}${replaceTabs(itemLines[j]!)}`);
			else lines.push(...renderStructuredRow(itemLines[j]!, continuePrefix, continuePrefix, viewportWidth));
		}
	}

	if (hasSummary) {
		lines.push(`${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", formatMoreItems(remaining, itemType))}`);
	}

	return lines;
}
