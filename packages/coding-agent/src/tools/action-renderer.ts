/** TUI renderer for lightweight action tools — checkpoint, rewind, cancel_job, poll. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type { CancelJobToolDetails } from "./cancel-job";
import type { CheckpointToolDetails, RewindToolDetails } from "./checkpoint";
import type { PollToolDetails } from "./poll-tool";
import { addSection, formatErrorMessage, replaceTabs } from "./render-utils";

type ActionDetails = CheckpointToolDetails | RewindToolDetails | CancelJobToolDetails | PollToolDetails;

type ActionRenderArgs = {
	goal?: string;
	report?: string;
	job_id?: string;
	jobs?: string[];
};

const CANCEL_STATUS_COLORS: Record<string, ThemeColor> = {
	cancelled: "success",
	not_found: "warning",
	already_completed: "dim",
};

const POLL_STATUS_COLORS: Record<string, ThemeColor> = {
	completed: "success",
	failed: "error",
	running: "chromeAccent",
	cancelled: "warning",
};

function formatDuration(ms: number): string {
	if (ms < 1_000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1_000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m${remainingSeconds}s`;
}

function isCheckpointDetails(d: ActionDetails): d is CheckpointToolDetails {
	return "goal" in d && "startedAt" in d;
}

function isRewindDetails(d: ActionDetails): d is RewindToolDetails {
	return "report" in d && "rewound" in d;
}

function isCancelJobDetails(d: ActionDetails): d is CancelJobToolDetails {
	return "status" in d && "jobId" in d;
}

function isPollDetails(d: ActionDetails): d is PollToolDetails {
	return "jobs" in d && Array.isArray((d as PollToolDetails).jobs);
}

function buildPollJobTable(details: PollToolDetails, uiTheme: Theme): string[] {
	const jobs = details.jobs;
	if (jobs.length === 0) return [uiTheme.fg("dim", "  No jobs.")];

	return jobs.map(job => {
		const statusColor = POLL_STATUS_COLORS[job.status] ?? "muted";
		const status = uiTheme.fg(statusColor, job.status.padEnd(10));
		const id = uiTheme.fg("toolOutput", job.id);
		const typeBadge = uiTheme.fg("dim", `[${job.type}]`);
		const label = uiTheme.fg("muted", job.label.length > 50 ? `${job.label.slice(0, 47)}…` : job.label);
		const duration = uiTheme.fg("dim", formatDuration(job.durationMs));
		return `  ${status}  ${id} ${typeBadge}  ${label}  ${duration}`;
	});
}

export const actionRenderer = {
	renderCall(args: ActionRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		let title: string;
		let description: string | undefined;

		if (args.goal !== undefined) {
			title = "Checkpoint";
			description = uiTheme.fg("muted", args.goal.length > 60 ? `${args.goal.slice(0, 57)}…` : args.goal);
		} else if (args.report !== undefined) {
			title = "Rewind";
		} else if (args.job_id !== undefined) {
			title = "Cancel Job";
			description = uiTheme.fg("muted", args.job_id);
		} else if (args.jobs !== undefined) {
			title = "Poll";
			description =
				args.jobs.length > 0
					? uiTheme.fg("muted", `${args.jobs.length} job${args.jobs.length !== 1 ? "s" : ""}`)
					: undefined;
		} else {
			title = "Poll";
		}

		const text = renderStatusLine({ icon: "pending", title, description }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: ActionDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		_args?: ActionRenderArgs,
	): Component {
		const details = result.details;
		const isError = result.isError === true;

		if (isError || !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const sections: Array<{ label?: string; lines: string[] }> = [];
		const meta: string[] = [];
		let title: string;
		let badgeLabel: string;
		let badgeColor: ThemeColor;

		if (isCheckpointDetails(details)) {
			title = "Checkpoint";
			badgeLabel = "created";
			badgeColor = "chromeAccent";
			addSection(sections, "Goal", [uiTheme.fg("toolOutput", `  ${details.goal}`)], uiTheme);
		} else if (isRewindDetails(details)) {
			title = "Rewind";
			badgeLabel = details.rewound ? "rewound" : "no-op";
			badgeColor = details.rewound ? "warning" : "dim";
			addSection(
				sections,
				"Report",
				details.report.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", `  ${line}`))),
				uiTheme,
			);
		} else if (isCancelJobDetails(details)) {
			title = "Cancel Job";
			badgeLabel = details.status;
			badgeColor = CANCEL_STATUS_COLORS[details.status] ?? "muted";
			meta.push(uiTheme.fg("dim", details.jobId));
			const text = result.content?.find(c => c.type === "text")?.text ?? "";
			addSection(sections, "Result", [uiTheme.fg("toolOutput", `  ${text}`)], uiTheme);
		} else if (isPollDetails(details)) {
			title = "Poll";
			const completed = details.jobs.filter(j => j.status !== "running");
			const running = details.jobs.filter(j => j.status === "running");
			badgeLabel = `${details.jobs.length} job${details.jobs.length !== 1 ? "s" : ""}`;
			badgeColor = running.length > 0 ? "chromeAccent" : "success";
			if (completed.length > 0) meta.push(uiTheme.fg("success", `${completed.length} done`));
			if (running.length > 0) meta.push(uiTheme.fg("chromeAccent", `${running.length} running`));
			addSection(sections, "Jobs", buildPollJobTable(details, uiTheme), uiTheme);
			for (const job of completed) {
				if (job.resultText) {
					const outputLines = job.resultText.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
					addSection(sections, `Output: ${job.id}`, outputLines, uiTheme, 30);
				}
				if (job.errorText) {
					addSection(sections, `Error: ${job.id}`, [uiTheme.fg("error", job.errorText)], uiTheme);
				}
			}
		} else {
			title = "Action";
			badgeLabel = "done";
			badgeColor = "muted";
			const text = result.content?.find(c => c.type === "text")?.text ?? "";
			addSection(
				sections,
				"Result",
				text.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line))),
				uiTheme,
			);
		}

		const header = renderStatusLine(
			{
				title,
				titleColor: "muted",
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
