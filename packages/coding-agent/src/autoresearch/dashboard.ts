import { matchesKey, replaceTabs, Text, truncateToWidth as tw, visibleWidth } from "@f5xc-salesdemos/pi-tui";
import type { Theme } from "../modes/theme/theme";
import { formatElapsed, formatNum } from "./helpers";
import * as S from "./state";
import type { AutoresearchRuntime, DashboardController, ExperimentState } from "./types";

export function createDashboardController(): DashboardController {
	let overlayTui: { requestRender(): void } | null = null;
	let spinnerTimer: NodeJS.Timeout | undefined;
	let spinnerFrame = 0;
	const requestRender = (): void => {
		overlayTui?.requestRender();
	};
	const clear = (): void => {
		overlayTui = null;
		clearInterval(spinnerTimer);
		spinnerTimer = undefined;
	};
	return {
		clear(ctx): void {
			clear();
			if (ctx.hasUI) ctx.ui.setWidget("autoresearch", undefined);
		},
		requestRender,
		updateWidget(ctx, runtime): void {
			if (!ctx.hasUI) return;
			const state = runtime.state;
			if (!shouldShowDashboard(runtime, state)) {
				ctx.ui.setWidget("autoresearch", undefined);
				return;
			}
			ctx.ui.setWidget("autoresearch", (_tui, theme) => {
				if (state.results.length === 0 && runtime.runningExperiment) {
					const p = [theme.fg("contentAccent", "autoresearch"), theme.fg("warning", " running...")];
					if (state.name) p.push(theme.fg("dim", ` | ${replaceTabs(state.name)}`));
					if (runtime.runningExperiment)
						p.push(theme.fg("dim", ` | ${replaceTabs(runtime.runningExperiment.command)}`));
					return new Text(p.join(""), 0, 0);
				}
				if (runtime.dashboardExpanded) {
					const width = process.stdout.columns ?? 120;
					const lines = [
						renderExpandedHeader(runtime, width, theme),
						...renderDashboardLines(runtime, width, theme, 8),
					];
					return new Text(lines.join("\n"), 0, 0);
				}
				return new Text(renderCollapsedLine(runtime, state, theme), 0, 0);
			});
		},
		async showOverlay(ctx, runtime): Promise<void> {
			if (!ctx.hasUI || !shouldShowDashboard(runtime, runtime.state)) return;
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					overlayTui = tui;
					if (!spinnerTimer) {
						spinnerTimer = setInterval(() => {
							spinnerFrame += 1;
							requestRender();
						}, 80);
					}
					let scrollOffset = 0;
					return {
						render(width: number): string[] {
							const terminalRows = process.stdout.rows ?? 40;
							const header = renderExpandedHeader(runtime, width, theme);
							const body = renderDashboardLines(runtime, width, theme, 0);
							if (runtime.runningExperiment)
								body.push(
									tw(
										theme.fg(
											"warning",
											`${theme.spinnerFrames[spinnerFrame % theme.spinnerFrames.length] ?? "*"} running ${formatElapsed(Date.now() - (runtime.runningExperiment?.startedAt ?? Date.now()))} ${replaceTabs(
												runtime.runningExperiment?.command ?? "",
											)}`,
										),
										width,
									),
								);
							const viewportRows = Math.max(4, terminalRows - 4);
							const maxScroll = Math.max(0, body.length - viewportRows);
							if (scrollOffset > maxScroll) scrollOffset = maxScroll;
							const visible = body.slice(scrollOffset, scrollOffset + viewportRows);
							const footerPos =
								body.length > viewportRows
									? ` ${scrollOffset + 1}-${Math.min(body.length, scrollOffset + viewportRows)}/${body.length}`
									: "";
							const footerHint = theme.fg("dim", ` up/down j/k pageup pagedown g G esc${footerPos} `);
							const footer =
								theme.fg("borderMuted", "-".repeat(Math.max(0, width - visibleWidth(footerHint)))) + footerHint;
							return [
								header,
								...visible,
								...Array.from({ length: Math.max(0, viewportRows - visible.length) }, () => ""),
								footer,
							];
						},
						handleInput(data: string): void {
							const totalRows =
								renderDashboardLines(runtime, process.stdout.columns ?? 120, theme, 0).length +
								(runtime.runningExperiment ? 1 : 0);
							const viewportRows = Math.max(4, (process.stdout.rows ?? 40) - 4);
							const maxScroll = Math.max(0, totalRows - viewportRows);
							if (matchesKey(data, "escape") || matchesKey(data, "esc") || data === "q") {
								done(undefined);
								return;
							}
							if (matchesKey(data, "up") || data === "k") {
								scrollOffset = Math.max(0, scrollOffset - 1);
							} else if (matchesKey(data, "down") || data === "j") {
								scrollOffset = Math.min(maxScroll, scrollOffset + 1);
							} else if (matchesKey(data, "pageUp")) {
								scrollOffset = Math.max(0, scrollOffset - viewportRows);
							} else if (matchesKey(data, "pageDown")) {
								scrollOffset = Math.min(maxScroll, scrollOffset + viewportRows);
							} else if (data === "g") {
								scrollOffset = 0;
							} else if (data === "G") {
								scrollOffset = maxScroll;
							}
							tui.requestRender();
						},
						invalidate(): void {},
						dispose(): void {
							clear();
						},
					};
				},
				{ overlay: true },
			);
		},
	};
}
function shouldShowDashboard(runtime: AutoresearchRuntime, state: ExperimentState): boolean {
	return (
		runtime.autoresearchMode ||
		state.results.length > 0 ||
		runtime.runningExperiment !== null ||
		runtime.lastRunSummary !== null
	);
}
function renderExpandedHeader(runtime: AutoresearchRuntime, width: number, theme: Theme): string {
	const status = renderModeStatus(runtime, runtime.state);
	const label = runtime.state.name ? ` autoresearch: ${replaceTabs(runtime.state.name)} ` : " autoresearch ";
	const hint = theme.fg("dim", ` ctrl+x collapse  ctrl+shift+x overlay${status ? `  ${status}` : ""} `);
	const fillWidth = Math.max(0, width - visibleWidth(label) - visibleWidth(hint));
	return tw(theme.fg("contentAccent", label) + theme.fg("borderMuted", "-".repeat(fillWidth)) + hint, width);
}
function renderCollapsedLine(runtime: AutoresearchRuntime, state: ExperimentState, theme: Theme): string {
	if (runtime.lastRunSummary) {
		const parts = [
			theme.fg("contentAccent", "autoresearch"),
			theme.fg("warning", ` pending run #${runtime.lastRunSummary.runNumber}`),
			theme.fg("dim", runtime.lastRunSummary.passed ? " pass" : " fail"),
		];
		if (runtime.lastRunSummary.parsedPrimary !== null)
			parts.push(
				theme.fg(
					"muted",
					` | ${state.metricName}=${formatNum(runtime.lastRunSummary.parsedPrimary, state.metricUnit)}`,
				),
			);
		parts.push(theme.fg("warning", " | log_experiment required"));
		if (!runtime.autoresearchMode) parts.push(theme.fg("dim", " | mode off"));
		return parts.join("");
	}
	if (state.results.length === 0) {
		const modeStatus = runtime.autoresearchMode ? "baseline pending" : "mode off";
		const parts = [theme.fg("contentAccent", "autoresearch"), theme.fg("warning", ` ${modeStatus}`)];
		if (state.name) parts.push(theme.fg("dim", ` | ${replaceTabs(state.name)}`));
		if (runtime.autoresearchMode) parts.push(theme.fg("dim", " | run the baseline"));
		return parts.join("");
	}
	const current = S.currentResults(state.results, state.currentSegment);
	const kept = current.filter(result => result.status === "keep").length;
	const crashed = current.filter(result => result.status === "crash").length;
	const checksFailed = current.filter(result => result.status === "checks_failed").length;
	const best = S.findBestKeptResult(state);
	const archivedRuns = Math.max(0, state.results.length - current.length);
	const parts = [
		theme.fg("contentAccent", "autoresearch"),
		theme.fg("muted", ` ${current.length} runs`),
		theme.fg("success", ` ${kept} kept`),
	];
	if (archivedRuns > 0) parts.push(theme.fg("dim", ` +${archivedRuns} archived`));
	if (crashed > 0) parts.push(theme.fg("error", ` ${crashed} crash`));
	if (checksFailed > 0) parts.push(theme.fg("error", ` ${checksFailed} checks_failed`));
	parts.push(theme.fg("dim", " | "));
	if (best && state.bestMetric !== null && best.result.metric !== state.bestMetric) {
		parts.push(theme.fg("warning", `best ${formatNum(best.result.metric, state.metricUnit)}`));
		parts.push(theme.fg("dim", ` baseline ${formatNum(state.bestMetric, state.metricUnit)}`));
	} else if (state.bestMetric !== null) {
		parts.push(theme.fg("warning", `baseline ${formatNum(state.bestMetric, state.metricUnit)}`));
	} else {
		parts.push(theme.fg("warning", `no kept runs yet`));
	}
	if (state.confidence !== null) {
		const confidenceColor = state.confidence >= 2 ? "success" : state.confidence >= 1 ? "warning" : "error";
		parts.push(theme.fg("dim", " | "), theme.fg(confidenceColor, `conf ${state.confidence.toFixed(1)}x`));
	}
	if (runtime.runningExperiment) {
		parts.push(theme.fg("dim", ` | running ${formatElapsed(Date.now() - runtime.runningExperiment.startedAt)}`));
	} else if (!runtime.autoresearchMode) {
		parts.push(theme.fg("dim", ` | ${renderModeStatus(runtime, state)}`));
	}
	parts.push(theme.fg("dim", " | ctrl+x expand"));
	return parts.join("");
}
function renderDashboardLines(runtime: AutoresearchRuntime, width: number, theme: Theme, maxRows: number): string[] {
	const state = runtime.state;
	if (state.results.length === 0) {
		if (runtime.lastRunSummary) {
			const lines = [
				tw(`Pending run: #${runtime.lastRunSummary.runNumber}`, width),
				tw(
					`Result: ${runtime.lastRunSummary.passed ? "passed" : "failed"}${runtime.lastRunSummary.parsedPrimary !== null ? `  ${state.metricName} ${formatNum(runtime.lastRunSummary.parsedPrimary, state.metricUnit)}` : ""}`,
					width,
				),
				tw("Next action: finish log_experiment before starting another run.", width),
			];
			if (!runtime.autoresearchMode) lines.push(tw("Mode: off", width));
			return lines;
		}
		if (runtime.autoresearchMode) {
			return [
				tw("Current segment: 0 runs", width),
				tw("Baseline: pending", width),
				tw("Next action: run and log the baseline experiment.", width),
			];
		}
		return [theme.fg("dim", "No experiments logged yet.")];
	}
	const current = S.currentResults(state.results, state.currentSegment);
	const kept = current.filter(result => result.status === "keep").length;
	const discarded = current.filter(result => result.status === "discard").length;
	const crashed = current.filter(result => result.status === "crash").length;
	const checksFailed = current.filter(result => result.status === "checks_failed").length;
	const baselineResult = S.findBaselineResult(state.results, state.currentSegment);
	const baseline = baselineResult?.metric ?? null;
	const baselineRunNumber = baselineResult
		? (baselineResult.runNumber ?? state.results.indexOf(baselineResult) + 1)
		: null;
	const baselineSecondary = S.findBaselineSecondary(state.results, state.currentSegment, state.secondaryMetrics);
	const best = S.findBestKeptResult(state);
	const lines = [
		tw(
			`Current segment: ${current.length} runs  ${kept} kept  ${discarded} discarded  ${crashed} crashed  ${checksFailed} checks_failed`,
			width,
		),
		tw(
			`Baseline: ${formatNum(baseline, state.metricUnit)}${baselineRunNumber ? ` (#${baselineRunNumber})` : ""}`,
			width,
		),
	];
	if (state.results.length > current.length)
		lines.push(tw(`Archived from earlier segments: ${state.results.length - current.length} runs`, width));
	if (runtime.lastRunSummary) {
		lines.push(
			tw(
				`Pending run: #${runtime.lastRunSummary.runNumber} (${runtime.lastRunSummary.passed ? "passed" : "failed"}) — log_experiment required`,
				width,
			),
		);
	}
	if (!runtime.autoresearchMode) lines.push(tw(`Mode: ${renderModeStatus(runtime, state)}`, width));
	if (best) {
		let progress = `Best: ${formatNum(best.result.metric, state.metricUnit)} (#${best.result.runNumber ?? best.index + 1})`;
		if (baseline !== null && baseline !== 0 && best.result.metric !== baseline)
			progress += ` ${formatDelta(best.result.metric, baseline)}`;
		if (state.confidence !== null) progress += `  conf ${state.confidence.toFixed(1)}x`;
		lines.push(tw(progress, width));
		if (state.secondaryMetrics.length > 0) {
			const details = state.secondaryMetrics
				.filter(m => best.result.metrics[m.name] !== undefined)
				.map(
					m => `${m.name} ${renderSecondaryCell(best.result.metrics[m.name]!, m.unit, baselineSecondary[m.name])}`,
				);
			if (details.length > 0) lines.push(tw(`Secondary: ${details.join("  ")}`, width));
		}
	}
	lines.push("");
	const secondaryHeader = state.secondaryMetrics.map(metric => tw(metric.name, 10)).join(" ");
	lines.push(
		tw(
			`${theme.fg("muted", "#".padEnd(4))}${theme.fg("muted", "commit".padEnd(10))}${theme.fg("warning", state.metricName.padEnd(12))}${secondaryHeader ? `${theme.fg("muted", secondaryHeader)} ` : ""}${theme.fg("muted", "status".padEnd(14))}${theme.fg("muted", "description")}`,
			width,
		),
	);
	lines.push(theme.fg("borderMuted", "-".repeat(Math.max(0, width - 1))));
	const visible = maxRows > 0 ? current.slice(-maxRows) : current;
	if (visible.length < current.length)
		lines.push(theme.fg("dim", `... ${current.length - visible.length} earlier runs hidden ...`));
	for (const result of visible) {
		const secondary = state.secondaryMetrics
			.map(m => tw(renderSecondaryCell(result.metrics[m.name], m.unit, baselineSecondary[m.name]), 10).padEnd(11))
			.join("");
		const statusColor = result.status === "keep" ? "success" : result.status === "discard" ? "warning" : "error";
		const line =
			theme.fg("dim", String(result.runNumber ?? state.results.indexOf(result) + 1).padEnd(4)) +
			theme.fg("contentAccent", (result.commit || "-").padEnd(10)) +
			theme.fg(statusColor, formatNum(result.metric, state.metricUnit).padEnd(12)) +
			secondary +
			theme.fg(statusColor, result.status.padEnd(14)) +
			theme.fg("muted", replaceTabs(result.description));
		lines.push(tw(line, width));
	}
	return lines;
}
function renderSecondaryCell(value: number | undefined, unit: string, baseline: number | undefined): string {
	if (value === undefined) return "-";
	const formatted = formatNum(value, unit);
	if (baseline === undefined || baseline === 0 || baseline === value) return formatted;
	return `${formatted} ${formatDelta(value, baseline)}`;
}
const formatDelta = (value: number, baseline: number): string =>
	(pct => `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`)(((value - baseline) / baseline) * 100);
function renderModeStatus(runtime: AutoresearchRuntime, state: ExperimentState): string {
	if (runtime.autoresearchMode) return state.results.length === 0 ? "baseline pending" : "mode on";
	const current = S.currentResults(state.results, state.currentSegment);
	return state.maxExperiments !== null && current.length >= state.maxExperiments ? "segment complete" : "mode off";
}
