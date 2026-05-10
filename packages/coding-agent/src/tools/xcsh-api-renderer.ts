/**
 * TUI renderer for the xcsh_api tool.
 *
 * Provides rich, context-aware visualization for F5 XC API calls:
 * - renderCall: method badge + compact path while request is pending
 * - renderResult: bordered output with intelligent response rendering:
 *   - List responses: compact resource name summary (capped at 20 items)
 *   - Single resources: Summary section (name, uid, created, status) + noise-reduced JSON
 *   - Create/Update: Created/Updated confirmation with key identity fields
 *   - Delete: contextual success message with resource name
 *   - Errors: API error message promoted to Guidance, JSON body suppressed
 *   - Request payload section for mutating methods (POST/PUT/PATCH)
 *
 * Header meta: context name, colored duration, item count, body size, error code label.
 * Borders: success=dim, error=red, pending=accent.
 * JSON noise reduction via stripEmpty (nulls, empty strings, empty arrays stripped;
 * empty objects preserved for F5 XC protobuf oneof markers).
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

/** Maximum response body lines before truncation. */
const MAX_RESPONSE_LINES = 80;

/** Maximum request payload lines before truncation. */
const MAX_PAYLOAD_LINES = 30;

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

/** Format byte size to human-readable string (e.g. "1.2 KB", "3.4 MB"). */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strip null, empty string, and empty array fields recursively.
 * Reduces JSON noise from F5 XC API responses which contain many null/empty defaults.
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
			if (v == null || v === "") continue;
			if (Array.isArray(v) && v.length === 0) continue;
			const cleaned = stripEmpty(v);
			if (cleaned != null) out[k] = cleaned;
		}
		return Object.keys(out).length > 0 ? out : null;
	}
	return obj;
}

/** Format ISO timestamp to human-readable: `2026-05-10T00:02:42.577Z` → `2026-05-10 00:02 UTC`. */
function formatTimestamp(iso: string): string {
	return iso
		.replace("T", " ")
		.replace(/:\d{2}\.\d+Z$/, " UTC")
		.replace(/:\d{2}Z$/, " UTC");
}

/** Push a labeled section with optional line truncation. */
function pushSection(
	sections: Array<{ label?: string; lines: string[] }>,
	label: string,
	lines: string[],
	maxLines: number,
	uiTheme: Theme,
): void {
	if (lines.length > maxLines) {
		const truncated = lines.slice(0, maxLines);
		truncated.push(uiTheme.fg("dim", `… ${lines.length - maxLines} more lines`));
		sections.push({ label, lines: truncated });
	} else {
		sections.push({ label, lines });
	}
}

/** Build a compact summary section for a single F5 XC resource (identity + spec). */
function buildResourceSummary(
	parsed: Record<string, unknown>,
	pathParts: string[],
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
	if (metadata.disable === true) lines.push(uiTheme.fg("warning", `  status:    DISABLED`));

	// Compact spec line: resource type from path + key config values
	const spec = parsed.spec;
	if (spec && typeof spec === "object") {
		const specEntries = Object.entries(spec as Record<string, unknown>);
		// Only show spec line when there are actual entries (skip empty spec: {})
		if (specEntries.length > 0) {
			const specScalars = specEntries
				.filter(
					([, v]) =>
						typeof v === "number" ||
						typeof v === "boolean" ||
						(typeof v === "string" && v.length > 0 && v.length <= 30),
				)
				.slice(0, 4)
				.map(([k, v]) => `${k}=${v}`)
				.join(", ");
			const resourceType = (pathParts.at(-2) ?? "config").replace(/_/g, " ").replace(/s$/, "");
			const specLine = specScalars ? `${resourceType} (${specScalars})` : resourceType;
			lines.push(uiTheme.fg("dim", `  spec:      ${specLine}`));
		}
	}

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
		// Compact long paths for pending state consistency with result header
		const parts = apiPath.split("/").filter(Boolean);
		const pendingPath = parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : apiPath;
		const text = renderStatusLine(
			{
				icon: "pending",
				title: TOOL_TITLE,
				description: pendingPath,
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

		// --- Header with separate method and status badges ---
		const methodBadge = { label: method, color: methodColor(method) };
		const errorLabel = details?.errorCodeLabel;
		const statusDisplay = errorLabel ? `${statusText} ${errorLabel}` : statusText;
		const statusBadge = uiTheme.fg(status > 0 ? statusColor(status) : "error", `[${statusDisplay}]`);

		const meta: string[] = [];
		meta.push(statusBadge);
		if (details?.contextName) meta.push(uiTheme.fg("statusLineContextF5xcFg", details.contextName));
		if (details?.durationMs !== undefined) {
			const durationColor: ThemeColor =
				details.durationMs < 200 ? "success" : details.durationMs > 1000 ? "warning" : "dim";
			meta.push(uiTheme.fg(durationColor, `${details.durationMs}ms`));
		}
		if (details?.itemCount !== undefined) meta.push(uiTheme.fg("dim", `${details.itemCount} items`));
		if (details?.bodySize !== undefined) meta.push(uiTheme.fg("dim", formatBytes(details.bodySize)));
		if (details?.contentType && !details.contentType.includes("json"))
			meta.push(uiTheme.fg("dim", details.contentType));
		// Show requestId for errors (useful for support/debugging)
		if (isError && details?.requestId) meta.push(uiTheme.fg("dim", `req:${details.requestId.slice(0, 8)}`));
		if (details?.retried) meta.push(uiTheme.fg("warning", "retried"));

		const compactPath = pathParts.length > 3 ? `…/${pathParts.slice(-3).join("/")}` : displayPath;

		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "contentAccent",
				description: compactPath,
				badge: methodBadge,
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		// --- Body sections ---
		const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
		const { json, guidance, raw } = splitResultContent(textContent, isError);
		const sections: Array<{ label?: string; lines: string[] }> = [];

		// Section 2: Request payload (for mutating methods with a body)
		if (args?.payload && method !== "GET") {
			try {
				const prettyPayload = JSON.stringify(args.payload, null, 2);
				const payloadLines = highlightCode(prettyPayload, "json");
				const sanitized = payloadLines.map(line => replaceTabs(line));
				// Show expanded variable substitutions
				if (details?.expandedVars && details.expandedVars.length > 0) {
					const varLines = details.expandedVars.map(({ variable, value }) =>
						uiTheme.fg("dim", `  ${variable} → ${value}`),
					);
					sanitized.push(...varLines);
				}
				pushSection(sections, uiTheme.fg("toolTitle", "Request"), sanitized, MAX_PAYLOAD_LINES, uiTheme);
			} catch {
				// Payload not serializable — skip section
			}
		}

		// Section: Response body — syntax-highlighted JSON or plain text
		// Parse JSON once for all intelligence branches
		const emptyBody = json === "{}" || (!json && (!raw.trim() || raw.trim() === "{}"));
		let parsed: Record<string, unknown> | null = null;
		if (json && !emptyBody) {
			try {
				parsed = JSON.parse(json) as Record<string, unknown>;
			} catch {
				// Not parseable — render raw
			}
		}
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
			sections.push({
				label: uiTheme.fg("toolTitle", "Response"),
				lines: [uiTheme.fg("dim", successMessage)],
			});
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
					pushSection(
						sections,
						uiTheme.fg("toolTitle", `Response (${itemEntries.length} items)`),
						summaryLines,
						maxListItems + 1,
						uiTheme,
					);
				}
			} else {
				// Branch 2: Single resource with metadata — summary + noise-reduced JSON
				const summary = !isError ? buildResourceSummary(parsed, pathParts, method, uiTheme) : null;
				if (summary) sections.push(summary);
				const isMutating = method === "POST" || method === "PUT" || method === "PATCH";

				// Determine if JSON body should be suppressed
				let apiErrorMessage: string | undefined;
				if (isError && typeof parsed.message === "string" && parsed.message) apiErrorMessage = parsed.message;
				const skipJsonBody = (summary && isMutating) || (isError && (guidance || apiErrorMessage));

				// Show extracted API error for errors without statusGuidance (400, 422, etc.)
				if (apiErrorMessage && !guidance) {
					sections.push({
						label: uiTheme.fg("toolTitle", "Error"),
						lines: [uiTheme.fg("error", apiErrorMessage)],
					});
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

					pushSection(sections, uiTheme.fg("toolTitle", responseLabel), highlighted, MAX_RESPONSE_LINES, uiTheme);
				}
			}
		} else if (json) {
			// Non-parseable JSON — render raw
			const highlighted = isError
				? json.split("\n").map(line => uiTheme.fg("dim", replaceTabs(line)))
				: highlightCode(json, "json").map(line => replaceTabs(line));
			sections.push({ label: uiTheme.fg("toolTitle", "Response"), lines: highlighted });
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

		// Section 4: Error guidance (for HTTP error responses)
		if (guidance) {
			// Extract the API's specific error message from JSON body for prominent display
			const guidanceLines: string[] = [];
			const apiMessage = parsed && typeof parsed.message === "string" ? parsed.message : undefined;
			if (apiMessage) guidanceLines.push(uiTheme.fg("error", apiMessage));
			guidanceLines.push(uiTheme.fg("warning", guidance));
			sections.push({ label: uiTheme.fg("toolTitle", "Guidance"), lines: guidanceLines });
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
