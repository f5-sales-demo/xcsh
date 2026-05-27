/** TUI renderer for GitLab tools — rich visual output at full parity with XC-API. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type { GlabToolDetails } from "./glab";
import type { GlabIssue } from "./glab/types";
import { addSection, formatErrorMessage, replaceTabs } from "./render-utils";

const TOOL_TITLE = "GitLab";
const MAX_TITLE_WIDTH = 50;
const MAX_DESCRIPTION_LINES = 20;
const MAX_COMMENT_LINES = 40;

type GlabRenderArgs = {
	action?: string;
	project?: string;
	issue?: number;
	query?: string;
	state?: string;
	labels?: string[];
	limit?: number;
	search?: string;
};

function issueStateColor(state: string): ThemeColor {
	return state === "opened" ? "success" : "dim";
}

function formatDate(iso: string): string {
	return iso.slice(0, 10);
}

function truncateTitle(title: string): string {
	if (title.length <= MAX_TITLE_WIDTH) return title;
	return `${title.slice(0, MAX_TITLE_WIDTH - 1)}…`;
}

function truncateLabels(labels: string[], maxLen = 30): string {
	if (!labels.length) return "";
	const joined = labels.join(", ");
	if (joined.length <= maxLen) return joined;
	const truncated = labels.slice(0, 3).join(", ");
	const remaining = labels.length - 3;
	return remaining > 0 ? `${truncated}, +${remaining}` : truncated;
}

function buildIssueTable(issues: GlabIssue[], uiTheme: Theme): string[] {
	if (issues.length === 0) return [uiTheme.fg("dim", "  No issues found.")];

	return issues.map(issue => {
		const iid = uiTheme.fg("toolOutput", `#${issue.iid}`);
		const title = uiTheme.fg("toolOutput", truncateTitle(issue.title));
		const state = uiTheme.fg(issueStateColor(issue.state), issue.state);
		const labels = issue.labels.length > 0 ? uiTheme.fg("muted", truncateLabels(issue.labels)) : "";
		const assignee =
			issue.assignees.length > 0
				? uiTheme.fg("dim", `@${issue.assignees[0]!.username}`)
				: uiTheme.fg("dim", "unassigned");
		const updated = uiTheme.fg("dim", formatDate(issue.updated_at));

		const parts = [`  ${iid}  ${title}  ${state}`];
		if (labels) parts.push(labels);
		parts.push(assignee, updated);
		return parts.join("  ");
	});
}

function buildIssueDetail(issue: GlabIssue, uiTheme: Theme): Array<{ label?: string; lines: string[] }> {
	const sections: Array<{ label?: string; lines: string[] }> = [];
	const kv = (label: string, value: string, valueColor: ThemeColor = "toolOutput") =>
		`  ${uiTheme.fg("dim", label.padEnd(12))}${uiTheme.fg(valueColor, value)}`;

	const summaryLines: string[] = [];
	summaryLines.push(kv("state:", issue.state, issueStateColor(issue.state)));
	summaryLines.push(kv("author:", `@${issue.author.username}`));
	summaryLines.push(kv("created:", formatDate(issue.created_at)));
	summaryLines.push(kv("updated:", formatDate(issue.updated_at)));
	if (issue.labels.length > 0) summaryLines.push(kv("labels:", issue.labels.join(", ")));
	const assigneeStr =
		issue.assignees.length > 0 ? issue.assignees.map(a => `@${a.username}`).join(", ") : "unassigned";
	summaryLines.push(kv("assignee:", assigneeStr));
	if (issue.milestone) summaryLines.push(kv("milestone:", issue.milestone.title));
	addSection(sections, "Summary", summaryLines, uiTheme);

	if (issue.description) {
		const descLines = issue.description.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
		addSection(sections, "Description", descLines, uiTheme, MAX_DESCRIPTION_LINES);
	}

	const humanNotes = (issue.notes ?? []).filter(n => !n.system);
	if (humanNotes.length > 0) {
		const commentLines: string[] = [];
		for (const note of humanNotes) {
			commentLines.push(
				`  ${uiTheme.fg("chromeAccent", `@${note.author.username}`)} ${uiTheme.fg("dim", formatDate(note.created_at))}`,
			);
			for (const line of note.body.split("\n")) {
				commentLines.push(`    ${uiTheme.fg("toolOutput", replaceTabs(line))}`);
			}
			commentLines.push("");
		}
		addSection(sections, `Comments (${humanNotes.length})`, commentLines, uiTheme, MAX_COMMENT_LINES);
	}

	return sections;
}

export const glabRenderer = {
	renderCall(args: GlabRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		let description: string;
		if (args.query) {
			description = uiTheme.fg("muted", `search: ${args.query}`);
		} else if (args.issue !== undefined) {
			description = uiTheme.fg("muted", `#${args.issue}`);
		} else if (args.action) {
			description = uiTheme.fg("muted", args.action);
		} else if (args.search) {
			description = uiTheme.fg("muted", `issues: ${args.search}`);
		} else {
			description = uiTheme.fg("muted", "issues");
		}
		const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GlabToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: GlabRenderArgs,
	): Component {
		const details = result.details;
		const isError = result.isError === true;

		if (isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const tool = details?.tool;
		const sections: Array<{ label?: string; lines: string[] }> = [];
		const meta: string[] = [];
		let description: string | undefined;
		let badgeLabel: string | undefined;
		let badgeColor: ThemeColor = "muted";

		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text ?? "Unknown error";
			addSection(sections, "Error", [uiTheme.fg("error", errorText)], uiTheme);
			const header = renderStatusLine(
				{ title: TOOL_TITLE, titleColor: "accent", badge: { label: "error", color: "error" } },
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

		if (tool === "glab_search" || tool === "glab_issue_list") {
			const items = details?.items ?? [];
			const count = details?.total ?? items.length;
			description = details?.query ? `search: ${details.query}` : "issues";
			meta.push(uiTheme.fg("dim", `${count} issue${count !== 1 ? "s" : ""}`));
			if (details?.project) meta.push(uiTheme.fg("muted", details.project));
			addSection(sections, "Results", buildIssueTable(items, uiTheme), uiTheme);
		} else if (tool === "glab_issue_view") {
			const issue = details?.issue;
			if (issue) {
				description = `#${issue.iid}: ${truncateTitle(issue.title)}`;
				meta.push(uiTheme.fg(issueStateColor(issue.state), issue.state));
				if (details?.project) meta.push(uiTheme.fg("muted", details.project));
				sections.push(...buildIssueDetail(issue, uiTheme));
			} else {
				const text = result.content?.find(c => c.type === "text")?.text ?? "";
				addSection(
					sections,
					"Result",
					text.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line))),
					uiTheme,
				);
			}
		} else if (tool === "glab_setup") {
			badgeLabel = args?.action ?? "setup";
			badgeColor = "chromeAccent";
			const text = result.content?.find(c => c.type === "text")?.text ?? "";
			addSection(
				sections,
				"Result",
				text.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line))),
				uiTheme,
			);
		} else {
			const text = result.content?.find(c => c.type === "text")?.text ?? "";
			addSection(
				sections,
				"Result",
				text.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line))),
				uiTheme,
			);
		}

		const header = description
			? renderStatusLine(
					{
						title: TOOL_TITLE,
						titleColor: "accent",
						description,
						meta: meta.length > 0 ? meta : undefined,
					},
					uiTheme,
				)
			: renderStatusLine(
					{
						title: TOOL_TITLE,
						titleColor: "accent",
						badge: badgeLabel ? { label: badgeLabel, color: badgeColor } : undefined,
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
