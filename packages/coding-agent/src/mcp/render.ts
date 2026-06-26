/**
 * TUI rendering for MCP tools.
 *
 * Provides structured display of MCP tool calls and results,
 * showing args and output in JSON tree format similar to task tool.
 */
import type { Component } from "@f5-sales-demo/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { highlightCode } from "../modes/theme/theme";
import {
	formatArgsInline,
	JSON_TREE_MAX_DEPTH_COLLAPSED,
	JSON_TREE_MAX_DEPTH_EXPANDED,
	JSON_TREE_MAX_LINES_COLLAPSED,
	JSON_TREE_MAX_LINES_EXPANDED,
	JSON_TREE_SCALAR_LEN_COLLAPSED,
	JSON_TREE_SCALAR_LEN_EXPANDED,
	renderJsonTreeLines,
	stripInternalArgs,
} from "../tools/json-tree";
import { formatExpandHint, truncateToWidth } from "../tools/render-utils";
import { renderStatusLine } from "../tui";
import type { MCPToolDetails } from "./tool-bridge";

/**
 * Render MCP tool call.
 */
export function renderMCPCall(args: Record<string, unknown>, theme: Theme, label: string): Component {
	return {
		render(width: number): string[] {
			const lines: string[] = [];
			lines.push(truncateToWidth(renderStatusLine({ icon: "pending", title: label }, theme), width));

			if (args && typeof args === "object" && Object.keys(args).length > 0) {
				const preview = formatArgsInline(args, Math.max(20, width - 20));
				if (preview) {
					lines.push(` ${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", preview)}`);
				}
			}

			return lines;
		},
		invalidate() {},
	};
}

/**
 * Render MCP tool result.
 */
export function renderMCPResult(
	result: { content: Array<{ type: string; text?: string }>; details?: MCPToolDetails; isError?: boolean },
	options: RenderResultOptions,
	theme: Theme,
	args?: Record<string, unknown>,
): Component {
	const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
	const trimmedOutput = textContent.trimEnd();

	return {
		render(width: number): string[] {
			const { expanded } = options;
			const lines: string[] = [];

			// Args section (when expanded)
			if (expanded && args && typeof args === "object" && Object.keys(args).length > 0) {
				lines.push(`${theme.fg("dim", "Args")}`);
				const maxDepth = JSON_TREE_MAX_DEPTH_EXPANDED;
				const maxLines = JSON_TREE_MAX_LINES_EXPANDED;
				const tree = renderJsonTreeLines(
					stripInternalArgs(args),
					theme,
					maxDepth,
					maxLines,
					JSON_TREE_SCALAR_LEN_EXPANDED,
				);
				for (const line of tree.lines) {
					lines.push(line);
				}
				if (tree.truncated) {
					lines.push(theme.fg("dim", "…"));
				}
				lines.push("");
			}

			// Output section
			if (!trimmedOutput) {
				lines.push(theme.fg("dim", "(no output)"));
				return lines;
			}

			// Try to parse as JSON for structured display
			if (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("[")) {
				try {
					const parsed = JSON.parse(trimmedOutput);
					const maxDepth = expanded ? JSON_TREE_MAX_DEPTH_EXPANDED : JSON_TREE_MAX_DEPTH_COLLAPSED;
					const maxLines = expanded ? JSON_TREE_MAX_LINES_EXPANDED : JSON_TREE_MAX_LINES_COLLAPSED;
					const maxScalarLen = expanded ? JSON_TREE_SCALAR_LEN_EXPANDED : JSON_TREE_SCALAR_LEN_COLLAPSED;
					const tree = renderJsonTreeLines(parsed, theme, maxDepth, maxLines, maxScalarLen);

					if (tree.lines.length > 0) {
						for (const line of tree.lines) {
							lines.push(line);
						}
						if (!expanded) {
							lines.push(formatExpandHint(theme, expanded, true));
						} else if (tree.truncated) {
							lines.push(theme.fg("dim", "…"));
						}
						return lines;
					}
				} catch {
					// Fall through to raw output
				}
			}

			// Raw text output
			const outputLines = trimmedOutput.split("\n");
			const maxOutputLines = expanded ? 12 : 4;
			const displayLines = outputLines.slice(0, maxOutputLines);

			const firstNonEmpty = trimmedOutput.trim();
			const isJson =
				firstNonEmpty.length <= 32_768 &&
				(firstNonEmpty[0] === "{" || firstNonEmpty[0] === "[") &&
				(() => {
					try {
						JSON.parse(firstNonEmpty);
						return true;
					} catch {
						return false;
					}
				})();

			if (isJson) {
				const highlighted = highlightCode(displayLines.join("\n"), "json");
				for (const line of highlighted) {
					lines.push(truncateToWidth(line, width));
				}
			} else {
				for (const line of displayLines) {
					lines.push(theme.fg("toolOutput", truncateToWidth(line, width)));
				}
			}

			if (outputLines.length > maxOutputLines) {
				const remaining = outputLines.length - maxOutputLines;
				lines.push(`${theme.fg("dim", `… ${remaining} more lines`)} ${formatExpandHint(theme, expanded, true)}`);
			} else if (!expanded) {
				lines.push(formatExpandHint(theme, expanded, true));
			}

			return lines;
		},
		invalidate() {},
	};
}
