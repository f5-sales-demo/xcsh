/** TUI renderer for the xcsh_api tool — rich, context-aware visualization for F5 XC API calls. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { highlightCode } from "../modes/theme/theme";
import { CachedOutputBlock, renderStatusLine } from "../tui";
import { formatErrorMessage, replaceTabs } from "./render-utils";
import type { XcshApiToolDetails } from "./xcsh-api";

const TOOL_TITLE = "XC-API";
const MAX_RESPONSE_LINES = 80;
const MAX_PAYLOAD_LINES = 30;

type XcshApiRenderArgs = {
	method?: string;
	path?: string;
	paths?: string[];
	params?: Record<string, string>;
	payload?: unknown;
};

const METHOD_COLORS: Partial<Record<string, ThemeColor>> = {
	POST: "chromeAccent",
	PUT: "contentAccent",
	PATCH: "contentAccent",
	DELETE: "warning",
};

function statusColor(status: number): ThemeColor {
	return status < 300 ? "success" : status < 400 ? "warning" : "error";
}

/**
 * Strip null, empty string, and empty array fields recursively.
 * Preserves empty objects `{}` — these are F5 XC protobuf oneof presence markers
 * (e.g. `use_origin_server_name: {}` means that option is selected).
 */
function stripEmpty(obj: unknown): unknown {
	if (Array.isArray(obj)) return obj.map(stripEmpty).filter(v => v != null);
	if (obj && typeof obj === "object") {
		const entries = Object.entries(obj as Record<string, unknown>);
		// Preserve source-empty objects (F5 XC oneof presence markers)
		if (entries.length === 0) return obj;
		const out: Record<string, unknown> = {};
		for (const [k, v] of entries) {
			if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
			const cleaned = stripEmpty(v);
			if (cleaned != null) out[k] = cleaned;
		}
		return Object.keys(out).length > 0 ? out : null;
	}
	return obj;
}
function formatTimestamp(iso: string): string {
	return iso.replace("T", " ").replace(/:\d{2}(\.\d+)?Z$/, " UTC");
}
function stripProtobufPrefix(message: string): string {
	return message.replace(/^ves\.io\.schema\.\S+:\s*/i, "");
}
function tryPrettyJson(text: string): string | null {
	try {
		return JSON.stringify(JSON.parse(text.trim()), null, 2);
	} catch {
		return null;
	}
}
function buildResourceSummary(
	parsed: Record<string, unknown>,
	_pathParts: string[],
	method: string,
	uiTheme: Theme,
): { label: string; lines: string[] } | null {
	const metadata = parsed.metadata as Record<string, unknown> | undefined;
	const sysMeta = parsed.system_metadata as Record<string, unknown> | undefined;
	if (!metadata || typeof metadata.name !== "string") return null;

	const lines: string[] = [];
	lines.push(uiTheme.fg("toolOutput", `  name:      ${metadata.name}`));
	if (typeof metadata.namespace === "string") lines.push(uiTheme.fg("dim", `  namespace: ${metadata.namespace}`));
	if (typeof sysMeta?.uid === "string") lines.push(uiTheme.fg("dim", `  uid:       ${sysMeta.uid}`));
	const createdAt = sysMeta?.creation_timestamp;
	if (typeof createdAt === "string") lines.push(uiTheme.fg("dim", `  created:   ${formatTimestamp(createdAt)}`));
	const creatorId = sysMeta?.creator_id;
	if (typeof creatorId === "string") lines.push(uiTheme.fg("dim", `  creator:   ${creatorId}`));
	if (metadata.disable === true) lines.push(uiTheme.fg("warning", `  status:    DISABLED`));

	const isMutating = method === "POST" || method === "PUT" || method === "PATCH";
	const label = isMutating ? (method === "POST" ? "Created" : "Updated") : "Summary";
	return { label: uiTheme.fg("toolTitle", label), lines };
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
		const pretty = tryPrettyJson(body);
		return pretty ? { json: pretty, raw: body } : { raw: body };
	}

	// Error: body is "compactJSON\n\nguidanceText"
	const guidanceSplit = body.indexOf("\n\n");
	if (guidanceSplit >= 0) {
		const jsonPart = body.slice(0, guidanceSplit);
		const guidancePart = body.slice(guidanceSplit + 2);
		const pretty = tryPrettyJson(jsonPart);
		if (pretty) return { json: pretty, guidance: guidancePart.trim(), raw: body };
		// First part isn't JSON — treat whole body as guidance
		return { guidance: body.trim(), raw: body };
	}

	// No double newline — might be just JSON or just text
	const pretty = tryPrettyJson(body);
	return pretty ? { json: pretty, raw: body } : { guidance: body.trim(), raw: body };
}

export const xcshApiToolRenderer = {
	renderCall(args: XcshApiRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const method = args.method ?? "???";
		const methodColor = METHOD_COLORS[method];
		const methodText = methodColor ? uiTheme.fg(methodColor, method) : method;
		const batchPaths = args.paths?.filter(Boolean);
		const description =
			batchPaths && batchPaths.length > 0
				? `${methodText} ${uiTheme.fg("muted", `batch (${batchPaths.length} paths)`)}`
				: `${methodText} ${uiTheme.fg("muted", args.path ?? "\u2026")}`;
		const text = renderStatusLine(
			{
				icon: "pending",
				title: TOOL_TITLE,
				description,
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
		// Path intelligence: extract resource name and compact display path
		const pathParts = displayPath.split("/").filter(Boolean);
		const resourceName = pathParts.at(-1) ?? "";

		const status = details?.status ?? 0;
		const statusText = status > 0 ? `${status}` : "failed";

		// Fallback: error without structured details (e.g. missing context/credentials)
		if (isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		// --- Batch mode: simplified rendering for multi-path concurrent GETs ---
		if (details?.batchSize) {
			const batchDesc = `${details.batchTotalItems ?? 0} items across ${details.batchSize} paths`;
			const batchStatus = uiTheme.fg("success", `[${details.batchSuccessCount ?? 0}/${details.batchSize} ok]`);
			const batchHeader = renderStatusLine(
				{
					title: TOOL_TITLE,
					titleColor: "contentAccent",
					description: `GET ${batchStatus} ${uiTheme.fg("muted", batchDesc)}`,
					meta: details.durationMs ? [uiTheme.fg("dim", `${details.durationMs}ms`)] : undefined,
				},
				uiTheme,
			);
			const bodyText = result.content?.find(c => c.type === "text")?.text ?? "";
			const bodyLines = bodyText.split("\n").map(line => replaceTabs(line));
			const batchSections: Array<{ label?: string; lines: string[] }> = [];
			const MAX_BATCH_LINES = 120;
			if (bodyLines.length > MAX_BATCH_LINES) {
				const truncated = bodyLines.slice(0, MAX_BATCH_LINES);
				truncated.push(uiTheme.fg("dim", `\u2026 ${bodyLines.length - MAX_BATCH_LINES} more lines`));
				batchSections.push({ label: uiTheme.fg("toolTitle", "Inventory"), lines: truncated });
			} else {
				batchSections.push({ label: uiTheme.fg("toolTitle", "Inventory"), lines: bodyLines });
			}
			const batchBlock = new CachedOutputBlock();
			return {
				render(width: number): string[] {
					const state = options.isPartial ? "pending" : "success";
					return batchBlock.render(
						{ header: batchHeader, state, sections: batchSections, width, borderColor: "border" },
						uiTheme,
					);
				},
				invalidate() {
					batchBlock.invalidate();
				},
			};
		}

		// --- Header: METHOD [STATUS] full-path ---
		const methodColor = METHOD_COLORS[method];
		const methodText = methodColor ? uiTheme.fg(methodColor, method) : method;
		const statusDisplay = details?.errorCodeLabel ? `${statusText} ${details.errorCodeLabel}` : statusText;
		const statusBadge = uiTheme.fg(status > 0 ? statusColor(status) : "error", `[${statusDisplay}]`);

		const meta: string[] = [];
		if (isError && details?.requestId) meta.push(uiTheme.fg("dim", `req:${details.requestId.slice(0, 8)}`));
		if (details?.retried) meta.push(uiTheme.fg("warning", "retried"));

		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "contentAccent",
				description: `${methodText} ${statusBadge} ${uiTheme.fg("muted", displayPath)}`,
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		// --- Body sections ---
		const { json, guidance, raw } = splitResultContent(
			result.content?.find(c => c.type === "text")?.text ?? "",
			isError,
		);
		const sections: Array<{ label?: string; lines: string[] }> = [];

		const addSection = (label: string, lines: string[], maxLines?: number): void => {
			const titled = uiTheme.fg("toolTitle", label);
			if (maxLines && lines.length > maxLines) {
				const truncated = lines.slice(0, maxLines);
				truncated.push(uiTheme.fg("dim", `… ${lines.length - maxLines} more lines`));
				sections.push({ label: titled, lines: truncated });
			} else {
				sections.push({ label: titled, lines });
			}
		};

		// Section: Request payload — show resolved body (actual JSON sent to API)
		if (method !== "GET" && (details?.resolvedPayload || args?.payload)) {
			try {
				const payloadSource = details?.resolvedPayload ? JSON.parse(details.resolvedPayload) : args?.payload;
				const prettyPayload = JSON.stringify(payloadSource, null, 2);
				const payloadLines = highlightCode(prettyPayload, "json");
				const sanitized = payloadLines.map(line => replaceTabs(line));
				addSection("Request", sanitized, MAX_PAYLOAD_LINES);
			} catch {
				// Payload not serializable — skip section
			}
		}

		// Section: Response body — syntax-highlighted JSON or plain text
		// Parse JSON once for all intelligence branches
		const emptyBody = json === "{}" || (!json && (!raw.trim() || raw.trim() === "{}"));
		const parsed =
			json && !emptyBody
				? (() => {
						try {
							return JSON.parse(json) as Record<string, unknown>;
						} catch {
							return null;
						}
					})()
				: null;
		const emptyList = Array.isArray(parsed?.items) && (parsed!.items as unknown[]).length === 0;

		if ((emptyBody || emptyList) && !guidance) {
			// Contextual success message based on HTTP method and response shape
			let successMessage = emptyList ? "No items found." : "Empty response";
			const rn = resourceName ? ` \u2018${resourceName}\u2019` : "";
			if (!emptyList && status >= 200 && status < 300) {
				if (method === "DELETE") successMessage = `Resource${rn} deleted successfully.`;
				else if (method === "POST") successMessage = `Resource${rn} created successfully.`;
				else if (method === "PUT" || method === "PATCH") successMessage = `Resource${rn} updated successfully.`;
			}
			addSection("Response", [uiTheme.fg("dim", successMessage)]);
		} else if (json && parsed) {
			// Branch 1: List response with named items — compact summary
			const items = parsed.items;
			if (Array.isArray(items) && items.length > 0) {
				const itemEntries = (items as Array<Record<string, unknown>>)
					.map(item => {
						const name = typeof item.name === "string" ? item.name : null;
						return name ? { name, disabled: item.disabled === true } : null;
					})
					.filter(Boolean) as Array<{ name: string; disabled: boolean }>;
				if (itemEntries.length > 0) {
					const maxListItems = 20;
					const displayed = itemEntries.slice(0, maxListItems);
					const summaryLines = displayed.map(({ name, disabled }) =>
						disabled
							? `  ${uiTheme.fg("dim", name)} ${uiTheme.fg("warning", "DISABLED")}`
							: uiTheme.fg("toolOutput", `  ${name}`),
					);
					if (itemEntries.length > maxListItems)
						summaryLines.push(uiTheme.fg("dim", `  … and ${itemEntries.length - maxListItems} more`));
					addSection(`Response (${itemEntries.length} items)`, summaryLines, maxListItems + 1);
				}
			} else {
				// Branch 2: Single resource with metadata — summary + noise-reduced JSON
				const summary = !isError ? buildResourceSummary(parsed, pathParts, method, uiTheme) : null;
				if (summary) sections.push(summary);
				const isMutating = method === "POST" || method === "PUT" || method === "PATCH";

				// Determine if JSON body should be suppressed
				let apiErrorMessage: string | undefined;
				if (isError && typeof parsed.message === "string" && parsed.message) {
					apiErrorMessage = stripProtobufPrefix(parsed.message);
				}
				const skipJsonBody = (summary && isMutating) || (isError && (apiErrorMessage || guidance));

				// Show extracted API error for errors without statusGuidance (400, 422, etc.)
				if (apiErrorMessage && !guidance) {
					addSection("Error", [uiTheme.fg("error", apiErrorMessage)]);
				}

				if (!skipJsonBody) {
					const displayJson = JSON.stringify(stripEmpty(parsed), null, 2) ?? json;
					const jsonLines = displayJson.split("\n");
					const highlighted = isError
						? jsonLines.map(line => uiTheme.fg("dim", replaceTabs(line)))
						: highlightCode(displayJson, "json").map(line => replaceTabs(line));

					let keyCount: number | undefined;
					if (typeof parsed === "object" && !Array.isArray(parsed)) keyCount = Object.keys(parsed).length;
					const responseLabel =
						keyCount !== undefined && keyCount > 0 ? `Response (${keyCount} keys)` : "Response";
					addSection(responseLabel, highlighted, MAX_RESPONSE_LINES);
				}
			}
		} else if (json) {
			// Non-parseable JSON — render raw
			const highlighted = isError
				? json.split("\n").map(line => uiTheme.fg("dim", replaceTabs(line)))
				: highlightCode(json, "json").map(line => replaceTabs(line));
			addSection("Response", highlighted);
		} else if (raw.trim() && !guidance) {
			// Non-JSON, non-guidance body
			addSection(
				"Response",
				raw
					.trim()
					.split("\n")
					.map(line => uiTheme.fg("toolOutput", replaceTabs(line))),
			);
		}

		// Section 4: Error guidance (for HTTP error responses)
		if (guidance) {
			// Extract the API's specific error message from JSON body for prominent display
			const guidanceLines: string[] = [];
			const apiMessage =
				parsed && typeof parsed.message === "string" ? stripProtobufPrefix(parsed.message) : undefined;
			if (apiMessage) guidanceLines.push(uiTheme.fg("error", apiMessage));
			guidanceLines.push(uiTheme.fg("warning", guidance));
			addSection("Guidance", guidanceLines);
		}

		// --- Render with CachedOutputBlock ---
		const outputBlock = new CachedOutputBlock();

		return {
			render(width: number): string[] {
				const state = options.isPartial ? "pending" : isError ? "error" : "success";
				return outputBlock.render({ header, state, sections, width, borderColor: "border" }, uiTheme);
			},
			invalidate() {
				outputBlock.invalidate();
			},
		};
	},
	mergeCallAndResult: true,
	inline: true,
};
