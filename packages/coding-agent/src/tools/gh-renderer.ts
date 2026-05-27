/** TUI renderer for gh_run_watch — bordered output with live-updating job trees. */
import { type Component, padding, Text, visibleWidth } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type {
	GhRunWatchFailedLogDetails,
	GhRunWatchJobDetails,
	GhRunWatchRunDetails,
	GhRunWatchViewDetails,
	GhToolDetails,
} from "./gh";
import {
	addSection,
	formatErrorMessage,
	formatExpandHint,
	PREVIEW_LIMITS,
	replaceTabs,
	type ToolUIColor,
	truncateToWidth as truncateVisualWidth,
} from "./render-utils";

type GhRunWatchRenderArgs = {
	run?: string;
	branch?: string;
};

const TOOL_TITLE = "GitHub Run Watch";

const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
const RUNNING_STATUSES = new Set(["in_progress"]);
const PENDING_STATUSES = new Set(["queued", "requested", "waiting", "pending"]);
const FALLBACK_WIDTH = 80;

function formatShortSha(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value.slice(0, 12);
}

function getRunLabel(run: GhRunWatchRunDetails): string {
	return replaceTabs(run.workflowName ?? run.displayTitle ?? "GitHub Actions");
}

function getJobStateVisual(
	job: GhRunWatchJobDetails,
	theme: Theme,
): { iconRaw: string; iconColor: ToolUIColor; textColor: ThemeColor } {
	if (job.conclusion && SUCCESS_CONCLUSIONS.has(job.conclusion)) {
		return { iconRaw: theme.status.success, iconColor: "success", textColor: "success" };
	}
	if (job.conclusion && FAILURE_CONCLUSIONS.has(job.conclusion)) {
		return { iconRaw: theme.status.error, iconColor: "error", textColor: "error" };
	}
	if (job.status && RUNNING_STATUSES.has(job.status)) {
		return { iconRaw: theme.status.enabled, iconColor: "warning", textColor: "warning" };
	}
	if (job.status && PENDING_STATUSES.has(job.status)) {
		return { iconRaw: theme.status.shadowed, iconColor: "muted", textColor: "muted" };
	}
	return { iconRaw: theme.status.shadowed, iconColor: "muted", textColor: "muted" };
}

function renderJobLine(job: GhRunWatchJobDetails, width: number, theme: Theme): string {
	const visual = getJobStateVisual(job, theme);
	const prefix = theme.fg(visual.iconColor, `${visual.iconRaw} `);
	const durationLabel = job.durationSeconds !== undefined ? `${job.durationSeconds}s` : undefined;
	const styledDuration = durationLabel ? theme.fg(visual.textColor, durationLabel) : undefined;
	const reservedWidth = visibleWidth(prefix) + (styledDuration ? 1 + visibleWidth(styledDuration) : 0);
	const nameWidth = Math.max(8, width - reservedWidth);
	const jobName = theme.fg(visual.textColor, truncateVisualWidth(replaceTabs(job.name), nameWidth));
	let line = `${prefix}${jobName}`;
	if (styledDuration) {
		line += padding(Math.max(1, width - visibleWidth(line) - visibleWidth(styledDuration)));
		line += styledDuration;
	}
	return line;
}

function buildRunJobLines(run: GhRunWatchRunDetails, width: number, theme: Theme): string[] {
	if (run.jobs.length === 0) return [theme.fg("dim", "  waiting for workflow jobs...")];
	return run.jobs.map(job => renderJobLine(job, width, theme));
}

function buildFailedLogLines(
	failedLogs: GhRunWatchFailedLogDetails[],
	width: number,
	theme: Theme,
	expanded: boolean,
): string[] {
	if (failedLogs.length === 0) return [];

	const lines: string[] = [];
	for (const entry of failedLogs) {
		const context = entry.workflowName ? `${entry.workflowName}  #${entry.runId}` : `run #${entry.runId}`;
		lines.push(
			theme.fg("error", `${theme.status.error} ${replaceTabs(entry.jobName)}  ${theme.fg("muted", context)}`),
		);

		if (!entry.available || !entry.tail) {
			lines.push(theme.fg("dim", "  log tail unavailable"));
			continue;
		}

		const tailLines = replaceTabs(entry.tail)
			.split("\n")
			.filter(line => line.length > 0);
		const previewLimit = expanded ? tailLines.length : Math.min(PREVIEW_LIMITS.OUTPUT_COLLAPSED, tailLines.length);
		for (const line of tailLines.slice(-previewLimit)) {
			lines.push(theme.fg("dim", `  ${truncateVisualWidth(line, Math.max(8, width - 2))}`));
		}

		if (!expanded && tailLines.length > previewLimit) {
			const remaining = tailLines.length - previewLimit;
			lines.push(theme.fg("dim", `  … ${remaining} more log lines ${formatExpandHint(theme, false, true)}`));
		}
	}
	return lines;
}

function deriveWatchState(watch: GhRunWatchViewDetails): "pending" | "success" | "error" {
	if (watch.state === "watching") return "pending";

	const allRuns = watch.mode === "run" && watch.run ? [watch.run] : (watch.runs ?? []);
	const hasFailure = allRuns.some(run =>
		run.jobs.some(job => job.conclusion && FAILURE_CONCLUSIONS.has(job.conclusion)),
	);
	if (hasFailure) return "error";

	const allDone = allRuns.every(run => run.jobs.length > 0 && run.jobs.every(job => job.conclusion));
	return allDone ? "success" : "pending";
}

export const ghRunWatchToolRenderer = {
	renderCall(args: GhRunWatchRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const runId = typeof args.run === "string" && args.run.trim().length > 0 ? args.run.trim() : undefined;
		const branch = typeof args.branch === "string" && args.branch.trim().length > 0 ? args.branch.trim() : undefined;

		let description: string;
		if (runId) {
			description = uiTheme.fg("muted", `run #${runId}`);
		} else if (branch) {
			description = uiTheme.fg("muted", branch);
		} else {
			description = uiTheme.fg("muted", "current HEAD");
		}

		const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GhToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const watch = result.details?.watch;
		const isError = result.isError === true;

		if (!watch && isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		if (!watch) {
			const text = result.content
				.filter(part => part.type === "text")
				.map(part => part.text)
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.join("\n");
			if (text) return new Text(replaceTabs(text), 0, 0);

			const header = renderStatusLine({ title: TOOL_TITLE, description: "no output" }, uiTheme);
			return new Text(header, 0, 0);
		}

		const outputBlock = new CachedOutputBlock();

		return {
			render(width: number): string[] {
				const lineWidth = Math.max(24, width || FALLBACK_WIDTH);
				const sections: Array<{ label?: string; lines: string[] }> = [];
				const meta: string[] = [];

				if (watch.note) {
					meta.push(uiTheme.fg("dim", replaceTabs(watch.note)));
				}

				// Build run sections
				if (watch.mode === "run" && watch.run) {
					const runLabel = getRunLabel(watch.run);
					const runMeta: string[] = [];
					if (watch.run.branch) runMeta.push(uiTheme.fg("muted", watch.run.branch));
					runMeta.push(uiTheme.fg("dim", `#${watch.run.id}`));

					addSection(sections, runLabel, buildRunJobLines(watch.run, lineWidth - 4, uiTheme), uiTheme);
				} else if (watch.mode === "commit") {
					const runs = watch.runs ?? [];
					if (runs.length === 0) {
						addSection(sections, "Workflows", [uiTheme.fg("dim", "  waiting for workflow runs...")], uiTheme);
					} else {
						for (const run of runs) {
							addSection(sections, getRunLabel(run), buildRunJobLines(run, lineWidth - 4, uiTheme), uiTheme);
						}
					}
				}

				// Failed logs section
				const failedLogLines = buildFailedLogLines(
					watch.failedLogs ?? [],
					lineWidth - 4,
					uiTheme,
					options.expanded,
				);
				if (failedLogLines.length > 0) {
					addSection(sections, "Failed Logs", failedLogLines, uiTheme);
				}

				// Build header
				let description: string;
				if (watch.mode === "run" && watch.run) {
					description =
						watch.state === "watching"
							? `watching run #${watch.run.id} on ${watch.repo}`
							: `run #${watch.run.id} on ${watch.repo}`;
				} else {
					const shortSha = formatShortSha(watch.headSha) ?? "this commit";
					description =
						watch.state === "watching"
							? `watching ${shortSha} on ${watch.repo}`
							: `runs for ${shortSha} on ${watch.repo}`;
				}

				const header = renderStatusLine(
					{
						title: TOOL_TITLE,
						titleColor: "contentAccent",
						description,
						meta: meta.length > 0 ? meta : undefined,
					},
					uiTheme,
				);

				const state = options.isPartial ? "pending" : deriveWatchState(watch);
				return outputBlock.render(
					{ header, state, sections, width: lineWidth, borderColor: F5_TOOL_BORDER_COLOR },
					uiTheme,
				);
			},
			invalidate() {
				outputBlock.invalidate();
			},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
