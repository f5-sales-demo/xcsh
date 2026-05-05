/**
 * Exa TUI Rendering
 *
 * Tree-based rendering with collapsed/expanded states for Exa search results.
 */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import { logger } from "@f5xc-salesdemos/pi-utils";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import {
	formatCount,
	formatExpandHint,
	formatMoreItems,
	getDomain,
	getPreviewLines,
	PREVIEW_LIMITS,
	truncateToWidth,
} from "../tools/render-utils";
import type { ExaRenderDetails } from "./types";

const COLLAPSED_PREVIEW_LINES = PREVIEW_LIMITS.COLLAPSED_LINES;
const EXPANDED_TEXT_LINES = 5;

function renderErrorMessage(message: string, theme: Theme): Text {
	const clean = message.replace(/^Error:\s*/, "").trim();
	return new Text(theme.fg("error", `Error: ${clean || "Unknown error"}`), 0, 0);
}

function renderEmptyMessage(message: string, theme: Theme): Text {
	return new Text(theme.fg("muted", message), 0, 0);
}

/** Render Exa result with tree-based layout */
export function renderExaResult(
	result: { content: Array<{ type: string; text?: string }>; details?: ExaRenderDetails },
	options: RenderResultOptions,
	uiTheme: Theme,
): Component {
	const details = result.details;

	if (details?.error) {
		logger.error("Exa render error", { error: details.error, toolName: details.toolName });
		return renderErrorMessage(details.error, uiTheme);
	}

	const response = details?.response;
	if (!response && !details?.raw) {
		return renderEmptyMessage("No response data", uiTheme);
	}

	return {
		render(width: number): string[] {
			const { expanded } = options;
			const contentWidth = Math.max(20, width - 6);

			if (!response) {
				const rawText = typeof details?.raw === "string" ? details.raw : JSON.stringify(details?.raw, null, 2);
				const rawLines = rawText.split("\n").filter(l => l.trim());
				const maxLines = expanded ? rawLines.length : Math.min(rawLines.length, COLLAPSED_PREVIEW_LINES);
				const displayLines = rawLines.slice(0, maxLines);
				const remaining = rawLines.length - maxLines;
				const expandHint = formatExpandHint(uiTheme, expanded, remaining > 0);

				const lines: string[] = [`${uiTheme.fg("dim", "Raw response")}${expandHint}`];

				for (let i = 0; i < displayLines.length; i++) {
					const isLast = i === displayLines.length - 1 && remaining === 0;
					const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
					lines.push(
						` ${uiTheme.fg("dim", branch)} ${uiTheme.fg("toolOutput", truncateToWidth(displayLines[i], contentWidth))}`,
					);
				}

				if (remaining > 0) {
					lines.push(
						` ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("muted", formatMoreItems(remaining, "line"))}`,
					);
				}

				return lines;
			}

			const results = response.results ?? [];
			const resultCount = results.length;
			const cost = response.costDollars?.total;
			const time = response.searchTime;

			const metaParts = [formatCount("result", resultCount)];
			if (cost !== undefined) metaParts.push(`cost:$${cost.toFixed(4)}`);
			if (time !== undefined) metaParts.push(`time:${time.toFixed(2)}s`);
			const summaryText = metaParts.join(uiTheme.sep.dot);

			let hasMorePreview = false;
			if (!expanded && resultCount > 0) {
				const previewText = results[0].text ?? results[0].title ?? "";
				const totalLines = previewText.split("\n").filter(l => l.trim()).length;
				hasMorePreview = totalLines > COLLAPSED_PREVIEW_LINES || resultCount > 1;
			}
			const expandHint = formatExpandHint(uiTheme, expanded, hasMorePreview);

			const lines: string[] = [`${uiTheme.fg("dim", summaryText)}${expandHint}`];

			if (!expanded) {
				if (resultCount === 0) {
					lines.push(` ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("muted", "No results")}`);
					return lines;
				}

				const first = results[0];
				const previewText = first.text ?? first.title ?? "";
				const previewLines = previewText ? getPreviewLines(previewText, COLLAPSED_PREVIEW_LINES, contentWidth) : [];
				const safePreviewLines = previewLines.length > 0 ? previewLines : ["No preview text"];
				const totalLines = previewText.split("\n").filter(l => l.trim()).length;
				const remainingLines = Math.max(0, totalLines - previewLines.length);
				const extraItems: string[] = [];
				if (remainingLines > 0) {
					extraItems.push(formatMoreItems(remainingLines, "line"));
				}
				if (resultCount > 1) {
					extraItems.push(formatMoreItems(resultCount - 1, "result"));
				}

				for (let i = 0; i < safePreviewLines.length; i++) {
					const isLast = i === safePreviewLines.length - 1 && extraItems.length === 0;
					const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
					const line = safePreviewLines[i];
					const color = line === "No preview text" ? "muted" : "toolOutput";
					lines.push(` ${uiTheme.fg("dim", branch)} ${uiTheme.fg(color, line)}`);
				}

				for (let i = 0; i < extraItems.length; i++) {
					const isLast = i === extraItems.length - 1;
					const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
					lines.push(` ${uiTheme.fg("dim", branch)} ${uiTheme.fg("muted", extraItems[i])}`);
				}

				return lines;
			}

			if (resultCount === 0) {
				lines.push(` ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("muted", "No results")}`);
				return lines;
			}

			for (let i = 0; i < results.length; i++) {
				const res = results[i];
				const isLast = i === results.length - 1;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				const cont = isLast ? " " : uiTheme.tree.vertical;

				const title = truncateToWidth(res.title ?? "Untitled", contentWidth);
				const domain = res.url ? getDomain(res.url) : "";
				const domainPart = domain ? uiTheme.fg("dim", ` (${domain})`) : "";

				lines.push(` ${uiTheme.fg("dim", branch)} ${uiTheme.fg("contentAccent", title)}${domainPart}`);

				if (res.url) {
					lines.push(
						` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("mdLinkUrl", res.url)}`,
					);
				}

				if (res.author) {
					lines.push(
						` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("muted", `Author: ${res.author}`)}`,
					);
				}

				if (res.publishedDate) {
					lines.push(
						` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("muted", `Published: ${res.publishedDate}`)}`,
					);
				}

				if (res.text) {
					const textLines = res.text.split("\n").filter(l => l.trim());
					const displayLines = textLines.slice(0, EXPANDED_TEXT_LINES);
					for (const line of displayLines) {
						lines.push(
							` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("toolOutput", truncateToWidth(line.trim(), contentWidth))}`,
						);
					}
					if (textLines.length > EXPANDED_TEXT_LINES) {
						lines.push(
							` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("muted", formatMoreItems(textLines.length - EXPANDED_TEXT_LINES, "line"))}`,
						);
					}
				}

				if (res.highlights?.length) {
					lines.push(
						` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("contentAccent", "Highlights")}`,
					);
					const maxHighlights = Math.min(res.highlights.length, 3);
					for (let j = 0; j < maxHighlights; j++) {
						const h = res.highlights[j];
						lines.push(
							` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("muted", `${uiTheme.format.dash} ${truncateToWidth(h, contentWidth)}`)}`,
						);
					}
					if (res.highlights.length > maxHighlights) {
						lines.push(
							` ${uiTheme.fg("dim", cont)} ${uiTheme.fg("dim", uiTheme.tree.hook)} ${uiTheme.fg("muted", formatMoreItems(res.highlights.length - maxHighlights, "highlight"))}`,
						);
					}
				}
			}

			return lines;
		},
		invalidate() {},
	};
}

/** Render Exa call (query/args preview) */
export function renderExaCall(args: Record<string, unknown>, toolName: string, uiTheme: Theme): Component {
	const toolLabel = toolName || "Exa Search";
	const numResults = typeof args.num_results === "number" ? args.num_results : undefined;

	return {
		render(width: number): string[] {
			const query = typeof args.query === "string" ? truncateToWidth(args.query, Math.max(20, width - 30)) : "?";
			let text = `${uiTheme.fg("toolTitle", toolLabel)} ${uiTheme.fg("contentAccent", query)}`;
			if (numResults !== undefined) {
				text += ` ${uiTheme.fg("muted", `results:${numResults}`)}`;
			}
			return [truncateToWidth(text, width)];
		},
		invalidate() {},
	};
}
