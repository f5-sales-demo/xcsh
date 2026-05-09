/**
 * TUI renderer for the xcsh_api tool.
 *
 * Provides rich, context-aware visualization for F5 XC API calls:
 * - renderCall: method badge + path while request is pending
 * - renderResult: bordered output block with syntax-highlighted JSON body,
 *   request details section, and error guidance section
 *
 * Uses CachedOutputBlock for bordered rendering with state-colored borders
 * (success → dim, error → red, pending → accent). JSON responses are
 * syntax-highlighted via the native pi-natives highlighter with theme colors.
 *
 * Always renders full output — no collapsed mode. This is the primary tool
 * for F5 XC platform operations and benefits from full visibility.
 */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { highlightCode } from "../modes/theme/theme";
import { CachedOutputBlock, renderStatusLine } from "../tui";
import { formatErrorMessage, replaceTabs } from "./render-utils";
import type { XcshApiToolDetails } from "./xcsh-api";

const TOOL_TITLE = "XC-API";

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

/**
 * Split the text content from the tool result into its constituent parts.
 *
 * Tool result text format:
 * - Success: `"200 OK\n\ncompactJSON"`
 * - Error:   `"404 Not Found\n\ncompactJSON\n\nguidanceText"`
 *
 * The compact JSON has no internal newlines (produced by `JSON.stringify(JSON.parse(raw))`
 * in xcsh-api.ts), so splitting on `\n\n` is reliable.
 */
function splitResultContent(textContent: string, isError: boolean): { json?: string; guidance?: string; raw: string } {
	// Strip status line prefix (e.g. "200 OK\n\n")
	const bodyStart = textContent.indexOf("\n\n");
	const body = bodyStart >= 0 ? textContent.slice(bodyStart + 2) : textContent;

	if (!isError) {
		// Success: entire body is JSON
		try {
			return { json: JSON.stringify(JSON.parse(body.trim()), null, 2), raw: body };
		} catch {
			return { raw: body };
		}
	}

	// Error: body is "compactJSON\n\nguidanceText"
	const guidanceSplit = body.indexOf("\n\n");
	if (guidanceSplit >= 0) {
		const jsonPart = body.slice(0, guidanceSplit);
		const guidancePart = body.slice(guidanceSplit + 2);
		try {
			return {
				json: JSON.stringify(JSON.parse(jsonPart.trim()), null, 2),
				guidance: guidancePart.trim(),
				raw: body,
			};
		} catch {
			// First part isn't JSON — treat whole body as guidance
			return { guidance: body.trim(), raw: body };
		}
	}

	// No double newline — might be just JSON or just text
	try {
		return { json: JSON.stringify(JSON.parse(body.trim()), null, 2), raw: body };
	} catch {
		return { guidance: body.trim(), raw: body };
	}
}

export const xcshApiToolRenderer = {
	renderCall(args: XcshApiRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const method = args.method ?? "???";
		const apiPath = args.path ?? "…";
		const text = renderStatusLine(
			{
				icon: "pending",
				title: TOOL_TITLE,
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
		const isError = result.isError === true;

		// Resolve display path: prefer the resolved URL pathname, fall back to template path
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

		// Fallback: error without structured details (e.g. missing context/credentials)
		if (isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		// --- Header ---
		const meta: string[] = [];
		if (details?.contextName) meta.push(uiTheme.fg("statusLineContextF5xcFg", details.contextName));
		if (details?.durationMs !== undefined) meta.push(uiTheme.fg("dim", `${details.durationMs}ms`));
		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "contentAccent",
				description: displayPath,
				badge: { label: `${method} ${statusText}`, color: status > 0 ? statusColor(status) : "error" },
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		// --- Body sections ---
		const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
		const { json, guidance, raw } = splitResultContent(textContent, isError);
		const sections: Array<{ label?: string; lines: string[] }> = [];

		// Section 1: Request line (method + full resolved URL)
		const requestLine = url ? `${method} ${url}` : `${method} ${displayPath}`;
		sections.push({ lines: [uiTheme.fg("dim", requestLine)] });

		// Section 2: Response body — syntax-highlighted JSON or plain text
		if (json) {
			const highlighted = highlightCode(json, "json");
			sections.push({
				label: uiTheme.fg("toolTitle", "Response"),
				lines: highlighted.map(line => replaceTabs(line)),
			});
		} else if (raw.trim() && !guidance) {
			// Non-JSON, non-guidance body
			sections.push({
				label: uiTheme.fg("toolTitle", "Response"),
				lines: raw
					.trim()
					.split("\n")
					.map(line => uiTheme.fg("toolOutput", replaceTabs(line))),
			});
		}

		// Section 3: Error guidance (for HTTP error responses)
		if (guidance) {
			sections.push({
				label: uiTheme.fg("toolTitle", "Guidance"),
				lines: [uiTheme.fg("warning", guidance)],
			});
		}

		// --- Render with CachedOutputBlock ---
		const outputBlock = new CachedOutputBlock();

		return {
			render(width: number): string[] {
				const state = options.isPartial ? "pending" : isError ? "error" : "success";
				return outputBlock.render({ header, state, sections, width }, uiTheme);
			},
			invalidate() {
				outputBlock.invalidate();
			},
		};
	},
	mergeCallAndResult: true,
	inline: true,
};
