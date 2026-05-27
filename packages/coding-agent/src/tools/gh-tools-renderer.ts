/** TUI renderer for GitHub tools — rich visual output for issue/PR/repo/search/diff/checkout/push. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type { GhToolDetails } from "./gh";
import { addSection, formatErrorMessage, replaceTabs } from "./render-utils";

const TOOL_TITLE = "GitHub";
const MAX_BODY_LINES = 30;
const MAX_DIFF_LINES = 80;
const MAX_SECTION_LINES = 40;

type GhRenderArgs = {
	repo?: string;
	branch?: string;
	issue?: string;
	pr?: string;
	query?: string;
	nameOnly?: boolean;
};

function ghStateColor(state: string | undefined): ThemeColor {
	if (!state) return "dim";
	const upper = state.toUpperCase();
	if (upper === "OPEN" || upper === "OPENED") return "success";
	if (upper === "CLOSED") return "dim";
	if (upper === "MERGED") return "chromeAccent";
	return "muted";
}

/** Extract key-value pairs from lines like "Key: Value". */
function extractKV(lines: string[]): Array<{ key: string; value: string }> {
	const pairs: Array<{ key: string; value: string }> = [];
	for (const line of lines) {
		const match = line.match(/^(\s*\S[^:]*?):\s+(.+)$/);
		if (match) {
			pairs.push({ key: match[1]!.trim(), value: match[2]!.trim() });
		}
	}
	return pairs;
}

/** Split markdown text into sections by ## headings. */
function splitSections(text: string): Array<{ heading: string; body: string }> {
	const result: Array<{ heading: string; body: string }> = [];
	const parts = text.split(/^## /m);
	for (const part of parts) {
		if (!part.trim()) continue;
		const newlineIdx = part.indexOf("\n");
		if (newlineIdx < 0) {
			result.push({ heading: part.trim(), body: "" });
		} else {
			result.push({ heading: part.slice(0, newlineIdx).trim(), body: part.slice(newlineIdx + 1).trim() });
		}
	}
	return result;
}

/** Build themed KV section from extracted pairs. */
function buildKVSection(pairs: Array<{ key: string; value: string }>, uiTheme: Theme): string[] {
	const maxKeyLen = Math.max(...pairs.map(p => p.key.length), 8);
	return pairs.map(p => {
		const stateKeys = new Set(["State", "Draft", "Review decision", "Merge state", "Visibility"]);
		const valueColor: ThemeColor = stateKeys.has(p.key) ? ghStateColor(p.value) : "toolOutput";
		return `  ${uiTheme.fg("dim", p.key.padEnd(maxKeyLen + 2))}${uiTheme.fg(valueColor, p.value)}`;
	});
}

/** Color diff lines using theme diff tokens. */
function colorDiffLines(lines: string[], uiTheme: Theme): string[] {
	return lines.map(line => {
		if (line.startsWith("+") && !line.startsWith("+++")) return uiTheme.fg("toolDiffAdded", replaceTabs(line));
		if (line.startsWith("-") && !line.startsWith("---")) return uiTheme.fg("toolDiffRemoved", replaceTabs(line));
		if (line.startsWith("@@")) return uiTheme.fg("chromeAccent", replaceTabs(line));
		if (line.startsWith("diff ") || line.startsWith("index ")) return uiTheme.fg("dim", replaceTabs(line));
		return uiTheme.fg("muted", replaceTabs(line));
	});
}

function renderMarkdownSections(
	text: string,
	uiTheme: Theme,
	sections: Array<{ label?: string; lines: string[] }>,
): void {
	// Extract the H1 title line and preamble KV
	const lines = text.split("\n");
	let titleLine: string | undefined;
	const preambleLines: string[] = [];
	let bodyStart = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith("# ") && !titleLine) {
			titleLine = line.slice(2).trim();
			continue;
		}
		if (line.startsWith("## ")) {
			bodyStart = i;
			break;
		}
		if (line.trim()) preambleLines.push(line);
		bodyStart = i + 1;
	}

	// Build themed KV from preamble, and preserve non-KV prose lines
	const kvPairs = extractKV(preambleLines);
	const nonKVLines = preambleLines.filter(line => !line.match(/^(\s*\S[^:]*?):\s+(.+)$/));
	if (kvPairs.length > 0) {
		addSection(sections, "Summary", buildKVSection(kvPairs, uiTheme), uiTheme);
	}
	if (nonKVLines.length > 0) {
		const proseLines = nonKVLines.map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
		addSection(sections, "Details", proseLines, uiTheme, MAX_BODY_LINES);
	}

	// Process ## sections
	const remainingText = lines.slice(bodyStart).join("\n");
	const mdSections = splitSections(remainingText);
	for (const section of mdSections) {
		const sectionLines = section.body
			.split("\n")
			.filter(l => l.trim())
			.map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
		if (sectionLines.length > 0) {
			const maxLines = section.heading.toLowerCase().includes("comment") ? MAX_SECTION_LINES : MAX_BODY_LINES;
			addSection(sections, section.heading, sectionLines, uiTheme, maxLines);
		}
	}
}

export const ghToolsRenderer = {
	renderCall(args: GhRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		let description: string | undefined;
		if (args.issue) {
			description = uiTheme.fg("muted", `issue ${args.issue}`);
		} else if (args.pr) {
			description = uiTheme.fg("muted", `PR ${args.pr}`);
		} else if (args.query) {
			description = uiTheme.fg("muted", `search: ${args.query}`);
		} else if (args.repo) {
			description = uiTheme.fg("muted", args.repo);
		}
		const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GhToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: GhRenderArgs,
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
		const textContent = result.content?.find(c => c.type === "text")?.text ?? "";

		if (isError) {
			addSection(sections, "Error", [uiTheme.fg("error", textContent || "Unknown error")], uiTheme);
			const header = renderStatusLine(
				{ title: TOOL_TITLE, titleColor: "contentAccent", badge: { label: "error", color: "error" } },
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

		if (tool === "gh_pr_diff") {
			description = args?.pr ? `PR ${args.pr} diff` : "diff";
			if (args?.nameOnly) {
				badgeLabel = "files";
				badgeColor = "contentAccent";
			}
			const diffLines = textContent.split("\n");
			const themed = args?.nameOnly
				? diffLines.map(line => uiTheme.fg("toolOutput", `  ${replaceTabs(line)}`))
				: colorDiffLines(diffLines, uiTheme);
			addSection(sections, args?.nameOnly ? "Files" : "Diff", themed, uiTheme, MAX_DIFF_LINES);
		} else if (tool === "gh_pr_checkout") {
			// Extract title from first markdown header
			const titleMatch = textContent.match(/^# (.+)/m);
			description = titleMatch ? titleMatch[1] : "checkout";
			if (details?.branch) meta.push(uiTheme.fg("dim", details.branch));
			if (details?.worktreePath) meta.push(uiTheme.fg("dim", details.worktreePath));
			renderMarkdownSections(textContent, uiTheme, sections);
		} else if (tool === "gh_pr_push") {
			description = "push";
			if (details?.branch) meta.push(uiTheme.fg("dim", details.branch));
			if (details?.remote) meta.push(uiTheme.fg("dim", `→ ${details.remote}:${details.remoteBranch ?? ""}`));
			renderMarkdownSections(textContent, uiTheme, sections);
		} else if (tool === "gh_search_issues" || tool === "gh_search_prs") {
			const kind = tool === "gh_search_issues" ? "issues" : "PRs";
			description = `search ${kind}: ${args?.query ?? ""}`;
			// Count results from markdown list items
			const resultCount = (textContent.match(/^- #\d+/gm) ?? []).length;
			meta.push(uiTheme.fg("dim", `${resultCount} result${resultCount !== 1 ? "s" : ""}`));
			renderMarkdownSections(textContent, uiTheme, sections);
		} else if (tool === "gh_repo_view") {
			const titleMatch = textContent.match(/^# (.+)/m);
			description = titleMatch ? titleMatch[1] : (details?.repo ?? args?.repo ?? "repo");
			renderMarkdownSections(textContent, uiTheme, sections);
		} else if (tool === "gh_issue_view") {
			const titleMatch = textContent.match(/^# Issue #(\d+): (.+)/m);
			if (titleMatch) {
				description = `#${titleMatch[1]}: ${titleMatch[2]}`;
			} else {
				description = args?.issue ? `issue ${args.issue}` : "issue";
			}
			// Extract state from KV
			const stateMatch = textContent.match(/^State:\s+(.+)/m);
			if (stateMatch) meta.push(uiTheme.fg(ghStateColor(stateMatch[1]), stateMatch[1]!));
			renderMarkdownSections(textContent, uiTheme, sections);
		} else if (tool === "gh_pr_view") {
			const titleMatch = textContent.match(/^# Pull Request #(\d+): (.+)/m);
			if (titleMatch) {
				description = `#${titleMatch[1]}: ${titleMatch[2]}`;
			} else {
				description = args?.pr ? `PR ${args.pr}` : "PR";
			}
			const stateMatch = textContent.match(/^State:\s+(.+)/m);
			if (stateMatch) meta.push(uiTheme.fg(ghStateColor(stateMatch[1]), stateMatch[1]!));
			const draftMatch = textContent.match(/^Draft:\s+(.+)/m);
			if (draftMatch?.[1] === "true") meta.push(uiTheme.fg("warning", "DRAFT"));
			renderMarkdownSections(textContent, uiTheme, sections);
		} else {
			// Fallback for unknown tool
			renderMarkdownSections(textContent, uiTheme, sections);
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
