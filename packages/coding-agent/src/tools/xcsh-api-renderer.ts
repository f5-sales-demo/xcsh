/**
 * TUI renderer for the xcsh_api tool.
 *
 * Provides context-aware visualization for F5 XC API calls:
 * - renderCall: method badge + path while request is pending
 * - renderResult: status code badge + JSON body preview (collapsed/expanded)
 */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { Ellipsis, Hasher, type RenderCache, renderStatusLine, truncateToWidth } from "../tui";
import { formatErrorMessage, PREVIEW_LIMITS, replaceTabs } from "./render-utils";
import type { XcshApiToolDetails } from "./xcsh-api";

interface XcshApiRenderArgs {
	method?: string;
	path?: string;
	params?: Record<string, string>;
	payload?: unknown;
}

/** Map HTTP method to a theme color for the badge. */
function methodColor(method: string): ThemeColor {
	switch (method) {
		case "GET":
			return "accent";
		case "DELETE":
			return "error";
		default:
			return "warning";
	}
}

/** Map HTTP status code to a theme color. */
function statusColor(status: number): ThemeColor {
	if (status < 300) return "success";
	if (status < 400) return "warning";
	return "error";
}

const COLLAPSED_BODY_LINES = PREVIEW_LIMITS.OUTPUT_COLLAPSED;

export const xcshApiToolRenderer = {
	renderCall(args: XcshApiRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const method = args.method ?? "???";
		const apiPath = args.path ?? "…";
		const text = renderStatusLine(
			{
				icon: "pending",
				title: "API",
				description: apiPath,
				badge: { label: method, color: methodColor(method) },
			},
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: XcshApiToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: XcshApiRenderArgs,
	): Component {
		const details = result.details;
		const method = details?.method ?? args?.method ?? "???";
		const url = details?.url;
		// Show resolved path (from URL) or the original template path
		let displayPath = args?.path ?? "…";
		if (url) {
			try {
				displayPath = new URL(url).pathname;
			} catch {
				// Malformed URL — fall through to args.path
			}
		}
		const status = details?.status ?? 0;
		const statusText = status > 0 ? `${status}` : "failed";

		if (result.isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const meta: string[] = [];
		if (details?.contextName) meta.push(uiTheme.fg("muted", details.contextName));
		if (details?.durationMs !== undefined) meta.push(uiTheme.fg("dim", `${details.durationMs}ms`));
		const header = renderStatusLine(
			{
				title: "API",
				description: displayPath,
				badge: { label: `${method} ${statusText}`, color: status > 0 ? statusColor(status) : "error" },
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
		// Split off the status line prefix (e.g. "200 OK\n\n") from the body
		const bodyStart = textContent.indexOf("\n\n");
		let body = bodyStart >= 0 ? textContent.slice(bodyStart + 2) : textContent;
		// Format JSON bodies for readable TUI display (error bodies include guidance text and won't parse)
		try {
			body = JSON.stringify(JSON.parse(body.trim()), null, 2);
		} catch {
			// Not valid JSON — keep as-is
		}
		const bodyLines = body.trim() ? replaceTabs(body).split("\n") : [];

		let cached: RenderCache | undefined;
		return {
			render(width: number): string[] {
				const { expanded } = options;
				const key = new Hasher().bool(expanded).u32(width).digest();
				if (cached?.key === key) return cached.lines;

				const lines: string[] = [header];

				if (bodyLines.length > 0) {
					if (expanded) {
						for (const line of bodyLines) {
							lines.push(truncateToWidth(uiTheme.fg("toolOutput", line), width, Ellipsis.Omit));
						}
					} else {
						const maxLines = COLLAPSED_BODY_LINES;
						const display = bodyLines.slice(0, maxLines);
						const remaining = bodyLines.length - maxLines;
						for (const line of display) {
							lines.push(truncateToWidth(uiTheme.fg("toolOutput", line), width, Ellipsis.Omit));
						}
						if (remaining > 0) {
							lines.push(uiTheme.fg("dim", `… (${remaining} more lines) (ctrl+o to expand)`));
						}
					}
				}

				cached = { key, lines };
				return lines;
			},
			invalidate() {
				cached = undefined;
			},
		};
	},
	mergeCallAndResult: true,
};
