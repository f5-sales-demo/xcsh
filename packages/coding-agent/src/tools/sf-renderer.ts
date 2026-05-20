/** TUI renderer for Salesforce tools — rich visual output at full parity with XC-API. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import { addSection, formatErrorMessage, replaceTabs } from "./render-utils";
import type { SfErrorType, SfToolDetails } from "./sf";
import { deriveQueryLabel, flattenRecord } from "./sf/formatters";
import type { SfOrg, SfQueryResult } from "./sf/types";

const TOOL_TITLE = "Salesforce";
const MAX_COL_WIDTH = 30;

type SfRenderArgs = {
	action?: string;
	query?: string;
	description?: string;
	target_org?: string;
};

const TOOL_ACTION_COLORS: Partial<Record<string, ThemeColor>> = {
	sf_setup: "chromeAccent",
	sf_query: "contentAccent",
};

const ERROR_GUIDANCE: Record<SfErrorType, string> = {
	auth_required: "Authenticate with: sf org login web --set-default --alias SFDC",
	session_expired: "Re-authenticate: sf org login web --set-default\nThen run sf_setup action 'status' to confirm",
	no_default_org: "Run sf_setup with action set_default to choose a default org",
	invalid_query:
		"Check field names and object types. Use SELECT ... FROM EntityDefinition to discover available objects",
	exec_error: "Check sf CLI is installed and configured correctly",
};

function orgStatusColor(status: string): ThemeColor {
	const lower = status.toLowerCase();
	if (lower === "connected") return "success";
	if (lower.includes("expired")) return "error";
	return "warning";
}

function truncateCell(value: string, maxWidth: number): string {
	if (value.length <= maxWidth) return value;
	return `${value.slice(0, maxWidth - 1)}…`;
}

function buildOrgRows(orgs: SfOrg[], uiTheme: Theme): string[] {
	return orgs.map(org => {
		const defaultBadge = org.isDefault ? ` ${uiTheme.fg("chromeAccent", "(default)")}` : "";
		const aliasText = org.alias
			? uiTheme.fg("toolOutput", org.alias) + defaultBadge
			: uiTheme.fg("dim", "(none)") + defaultBadge;
		const username = uiTheme.fg("dim", org.username);
		const status = uiTheme.fg(orgStatusColor(org.connectedStatus), org.connectedStatus);
		const sandboxBadge = org.isSandbox ? `  ${uiTheme.fg("warning", "[sandbox]")}` : "";
		return `  ${aliasText}  ${username}  ${status}${sandboxBadge}`;
	});
}

function buildQueryTable(queryResult: SfQueryResult, uiTheme: Theme): string[] {
	const records = queryResult.records as Record<string, unknown>[];
	if (records.length === 0) return [uiTheme.fg("dim", "  No records found.")];

	const flatRecords = records.map(r => flattenRecord(r));
	const allColumns = Array.from(
		flatRecords.reduce((cols, record) => {
			for (const key of Object.keys(record)) cols.add(key);
			return cols;
		}, new Set<string>()),
	);

	const colWidths = allColumns.map(col => {
		const maxData = flatRecords.reduce((max, rec) => {
			const val = rec[col];
			return Math.max(max, val == null ? 0 : String(val).replace(/[\n\r\t]+/g, " ").length);
		}, 0);
		return Math.min(MAX_COL_WIDTH, Math.max(col.length, maxData));
	});

	const lines: string[] = [];

	// Header
	const headerCells = allColumns.map((col, i) => uiTheme.fg("toolTitle", col.padEnd(colWidths[i]!)));
	lines.push(`  ${headerCells.join("  ")}`);

	// Separator
	const sepCells = colWidths.map(w => uiTheme.fg("dim", "─".repeat(w)));
	lines.push(`  ${sepCells.join("  ")}`);

	// Rows
	for (const rec of flatRecords) {
		const cells = allColumns.map((col, i) => {
			const val = rec[col];
			const raw = val == null ? "" : String(val).replace(/[\n\r\t]+/g, " ");
			const cell = truncateCell(raw, colWidths[i]!).padEnd(colWidths[i]!);
			return val == null || raw === "" ? uiTheme.fg("dim", cell) : uiTheme.fg("toolOutput", cell);
		});
		lines.push(`  ${cells.join("  ")}`);
	}

	return lines;
}

function buildOrgKV(org: SfOrg, uiTheme: Theme): string[] {
	const line = (label: string, value: string, valueColor: ThemeColor = "toolOutput") =>
		`  ${uiTheme.fg("dim", label.padEnd(10))}${uiTheme.fg(valueColor, value)}`;

	const lines: string[] = [];
	if (org.alias) lines.push(line("alias:", org.alias));
	lines.push(line("username:", org.username));
	lines.push(line("org id:", org.orgId));
	lines.push(line("instance:", org.instanceUrl));
	lines.push(line("status:", org.connectedStatus, orgStatusColor(org.connectedStatus)));
	if (org.isSandbox) lines.push(line("type:", "Sandbox", "warning"));
	if (org.isDefault) lines.push(line("default:", "yes", "chromeAccent"));
	return lines;
}

export const sfToolRenderer = {
	renderCall(args: SfRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		if (args.query !== undefined) {
			const description = args.description ?? deriveQueryLabel(args.query);
			const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description }, uiTheme);
			return new Text(text, 0, 0);
		}
		if (args.action === undefined && args.query === undefined) {
			// Pipeline report — no action or query args
			const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description: "pipeline report" }, uiTheme);
			return new Text(text, 0, 0);
		}
		const action = args.action ?? "org";
		const text = renderStatusLine(
			{
				icon: "pending",
				title: TOOL_TITLE,
				badge: { label: action, color: "chromeAccent" },
			},
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: SfToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: SfRenderArgs,
	): Component {
		const details = result.details;
		const isError = result.isError === true;

		// Fallback: error without structured details
		if (isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const tool = details?.tool;
		const action = details?.action;
		const errorType = details?.errorType;
		const sections: Array<{ label?: string; lines: string[] }> = [];

		// --- Error path ---
		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text ?? "Unknown error";
			addSection(sections, "Error", [uiTheme.fg("error", errorText)], uiTheme);

			const badgeLabel = errorType ?? "error";
			if (errorType) {
				const guidance = ERROR_GUIDANCE[errorType];
				const guidanceLines = guidance.split("\n").map(l => uiTheme.fg("warning", l));
				addSection(sections, "Guidance", guidanceLines, uiTheme);
			}

			const header = renderStatusLine(
				{
					title: TOOL_TITLE,
					titleColor: "contentAccent",
					badge: { label: badgeLabel, color: "error" },
				},
				uiTheme,
			);
			const outputBlock = new CachedOutputBlock();
			return {
				render(width: number): string[] {
					return outputBlock.render({ header, state: "error", sections, width }, uiTheme);
				},
				invalidate() {
					outputBlock.invalidate();
				},
			};
		}

		// --- Success path ---
		let badgeLabel = action ?? tool?.replace("sf_", "") ?? "sf";
		const badgeColor: ThemeColor = tool ? (TOOL_ACTION_COLORS[tool] ?? "muted") : "muted";
		const meta: string[] = [];
		let description: string | undefined;

		if (tool === "sf_setup") {
			const orgs = details?.orgs;
			if ((action === "status" || action === "list_orgs") && orgs !== undefined) {
				const count = orgs.length;
				meta.push(uiTheme.fg("dim", `${count} org${count !== 1 ? "s" : ""}`));
				if (count === 0) {
					addSection(sections, "Orgs", [uiTheme.fg("dim", "No authenticated orgs found.")], uiTheme);
				} else {
					addSection(sections, "Orgs", buildOrgRows(orgs, uiTheme), uiTheme);
				}
			} else {
				const text = result.content?.find(c => c.type === "text")?.text ?? "";
				addSection(
					sections,
					"Result",
					text.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line))),
					uiTheme,
				);
			}
		} else if (tool === "sf_query") {
			const queryResult = details?.queryResult;
			description =
				details?.queryDescription ?? args?.description ?? (args?.query ? deriveQueryLabel(args.query) : undefined);
			if (queryResult) {
				const count = queryResult.totalSize;
				meta.push(uiTheme.fg("dim", `${count} record${count !== 1 ? "s" : ""}`));
				if (args?.target_org) meta.push(uiTheme.fg("muted", `@${args.target_org}`));
				addSection(sections, "Results", buildQueryTable(queryResult, uiTheme), uiTheme);
				if (!queryResult.done) {
					addSection(
						sections,
						"Warning",
						[uiTheme.fg("warning", "Results are incomplete. Use sf data export bulk for the full dataset.")],
						uiTheme,
					);
				}
			} else {
				const text = result.content?.find(c => c.type === "text")?.text ?? "";
				addSection(sections, "Result", [uiTheme.fg("toolOutput", text)], uiTheme);
			}
		} else if (tool === "sf_org_display") {
			const org = details?.orgs?.[0];
			if (org) {
				badgeLabel = "org";
				meta.push(uiTheme.fg("muted", org.alias ?? org.username));
				meta.push(uiTheme.fg(orgStatusColor(org.connectedStatus), org.connectedStatus));
				addSection(sections, "Summary", buildOrgKV(org, uiTheme), uiTheme);
			} else {
				const text = result.content?.find(c => c.type === "text")?.text ?? "";
				addSection(sections, "Result", [uiTheme.fg("toolOutput", text)], uiTheme);
			}
		} else if (tool === "sf_pipeline_report") {
			description = "pipeline report";
			const report = details?.pipelineReport;
			if (report) {
				const acctCount =
					report.netNew.accounts.length + report.booked.accounts.length + report.renewals.accounts.length;
				meta.push(uiTheme.fg("dim", `${report.lineItemCount} items`));
				meta.push(uiTheme.fg("dim", `${acctCount} accounts`));
				if (report.anomalies.length > 0) {
					meta.push(uiTheme.fg("warning", `${report.anomalies.length} anomalies`));
				}

				const fc = report.forecast;
				const fmtK = (v: number) =>
					v >= 1_000_000
						? `$${(v / 1_000_000).toFixed(1)}M`
						: v >= 1_000
							? `$${(v / 1_000).toFixed(0)}K`
							: `$${v.toFixed(0)}`;
				const summaryLines = [
					`  ${uiTheme.fg("toolTitle", "Commit".padEnd(12))}${uiTheme.fg("toolOutput", fmtK(fc.commit))}`,
					`  ${uiTheme.fg("toolTitle", "Best Case".padEnd(12))}${uiTheme.fg("toolOutput", fmtK(fc.bestCase))}`,
					`  ${uiTheme.fg("toolTitle", "Pipeline".padEnd(12))}${uiTheme.fg("toolOutput", fmtK(fc.pipeline))}`,
				];
				addSection(sections, "Forecast", summaryLines, uiTheme);

				const text = result.content?.find(c => c.type === "text")?.text ?? "";
				const reportLines = text.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
				addSection(sections, "Report", reportLines, uiTheme);

				if (report.anomalies.length > 0) {
					const anomalyLines = report.anomalies.map(a => {
						const icon = a.severity === "warning" ? "[WARN]" : a.severity === "error" ? "[ERR]" : "[INFO]";
						return uiTheme.fg(a.severity === "info" ? "muted" : "warning", `  ${icon} ${a.message}`);
					});
					addSection(sections, "Anomalies", anomalyLines, uiTheme);
				}
			} else {
				const text = result.content?.find(c => c.type === "text")?.text ?? "";
				addSection(sections, "Result", [uiTheme.fg("toolOutput", text)], uiTheme);
			}
		} else {
			const text = result.content?.find(c => c.type === "text")?.text ?? "";
			addSection(sections, "Result", [uiTheme.fg("toolOutput", text)], uiTheme);
		}

		const header = description
			? renderStatusLine(
					{
						title: TOOL_TITLE,
						titleColor: "contentAccent",
						description,
						meta: meta.length > 0 ? meta : undefined,
					},
					uiTheme,
				)
			: renderStatusLine(
					{
						title: TOOL_TITLE,
						titleColor: "contentAccent",
						badge: { label: badgeLabel, color: badgeColor },
						meta: meta.length > 0 ? meta : undefined,
					},
					uiTheme,
				);

		const outputBlock = new CachedOutputBlock();
		return {
			render(width: number): string[] {
				const state = options.isPartial ? "pending" : "success";
				return outputBlock.render({ header, state, sections, width, borderColor: F5_TOOL_BORDER_COLOR }, uiTheme);
			},
			invalidate() {
				outputBlock.invalidate();
			},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
