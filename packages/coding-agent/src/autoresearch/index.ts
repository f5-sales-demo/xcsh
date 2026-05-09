import * as fs from "node:fs";
import * as path from "node:path";
import type { AutocompleteItem } from "@f5xc-salesdemos/pi-tui";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import type { ExtensionContext, ExtensionFactory } from "../extensibility/extensions";
import commandResumeTemplate from "./command-resume.md" with { type: "text" };
import { pathMatchesContractPath } from "./contract";
import { createDashboardController } from "./dashboard";
import { ensureAutoresearchBranch } from "./git";
import {
	formatNum,
	isAutoresearchCommittableFile,
	isAutoresearchLocalStatePath,
	normalizeAutoresearchPath,
	readMaxExperiments,
	readPendingRunSummary,
	resolveWorkDir,
	validateWorkDir,
} from "./helpers";
import promptTemplate from "./prompt.md" with { type: "text" };
import resumeMessageTemplate from "./resume-message.md" with { type: "text" };
import {
	cloneExperimentState,
	createExperimentState,
	createRuntimeStore,
	currentResults,
	findBaselineMetric,
	findBestKeptResult,
	reconstructControlState,
	reconstructStateFromJsonl,
} from "./state";
import { createInitExperimentTool } from "./tools/init-experiment";
import { createLogExperimentTool } from "./tools/log-experiment";
import { createRunExperimentTool } from "./tools/run-experiment";
import type { AutoresearchRuntime, ExperimentResult, PendingRunSummary } from "./types";

const EXPERIMENT_TOOL_NAMES = ["init_experiment", "run_experiment", "log_experiment"];
const EXPERIMENT_TOOL_SET = new Set(EXPERIMENT_TOOL_NAMES);
const addExperimentTools = (tools: string[]) => [...new Set([...tools, ...EXPERIMENT_TOOL_NAMES])];
const removeExperimentTools = (tools: string[]) => tools.filter(name => !EXPERIMENT_TOOL_SET.has(name));
export const createAutoresearchExtension: ExtensionFactory = api => {
	const runtimeStore = createRuntimeStore();
	const dashboard = createDashboardController();
	const getSessionKey = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId();
	const getRuntime = (ctx: ExtensionContext): AutoresearchRuntime => runtimeStore.ensure(getSessionKey(ctx));
	const rehydrate = async (ctx: ExtensionContext): Promise<void> => {
		const runtime = getRuntime(ctx);
		const workDir = resolveWorkDir(ctx.cwd);
		const reconstructed = reconstructStateFromJsonl(workDir);
		const control = reconstructControlState(ctx.sessionManager.getBranch());
		const loggedRunNumbers = collectLoggedRunNumbers(reconstructed.state.results);
		runtime.state = cloneExperimentState(reconstructed.state);
		runtime.state.maxExperiments = readMaxExperiments(ctx.cwd);
		runtime.goal = control.goal;
		runtime.autoresearchMode = control.autoresearchMode;
		runtime.autoResumeArmed = false;
		runtime.lastAutoResumePendingRunNumber = null;
		applyPendingRunToRuntime(runtime, await readPendingRunSummary(workDir, loggedRunNumbers));
		runtime.runningExperiment = null;
		dashboard.updateWidget(ctx, runtime);
		const activeTools = api.getActiveTools();

		const nextActiveTools = runtime.autoresearchMode
			? addExperimentTools(activeTools)
			: removeExperimentTools(activeTools);
		const toolsChanged =
			nextActiveTools.length !== activeTools.length ||
			nextActiveTools.some((name, index) => name !== activeTools[index]);
		if (toolsChanged) await api.setActiveTools(nextActiveTools);
	};
	const setMode = (
		ctx: ExtensionContext,
		enabled: boolean,
		goal: string | null,
		mode: "on" | "off" | "clear",
	): void => {
		const runtime = getRuntime(ctx);
		runtime.autoresearchMode = enabled;
		runtime.autoResumeArmed = false;
		runtime.goal = goal;
		runtime.lastAutoResumePendingRunNumber = null;
		api.appendEntry("autoresearch-control", goal ? { mode, goal } : { mode });
	};
	api.registerTool(createInitExperimentTool({ dashboard, getRuntime, pi: api }));
	api.registerTool(createRunExperimentTool({ dashboard, getRuntime, pi: api }));
	api.registerTool(createLogExperimentTool({ dashboard, getRuntime, pi: api }));
	api.on("tool_call", (event, ctx) => {
		const runtime = getRuntime(ctx);
		if (!runtime.autoresearchMode) return;
		if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "ast_edit") return;

		const rawPaths =
			event.toolName === "write" || event.toolName === "ast_edit"
				? typeof event.input.path === "string"
					? [event.input.path]
					: null
				: event.toolName === "edit"
					? ["path", "rename", "move"].map(k => event.input[k]).filter((v): v is string => typeof v === "string")
					: [];
		if (rawPaths === null)
			return {
				block: true,
				reason:
					"Autoresearch requires an explicit target path for this editing tool so it can enforce Files in Scope and Off Limits before changes are made.",
			};

		const workDir = resolveWorkDir(ctx.cwd);
		for (const rawPath of rawPaths) {
			const relativePath = resolveAutoresearchRelativePath(workDir, rawPath);
			if (!relativePath.ok) return { block: true, reason: relativePath.reason };
			const validationError = validateEditableAutoresearchPath(relativePath.relativePath, runtime);
			if (validationError)
				return {
					block: true,
					reason: `Autoresearch blocked edits to ${relativePath.relativePath}: ${validationError}`,
				};
		}
	});
	api.registerCommand("autoresearch", {
		description: "Toggle builtin autoresearch mode, or pass off / clear, or a goal message.",
		getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
			if (argumentPrefix.includes(" ")) return null;
			const normalized = argumentPrefix.trim().toLowerCase();
			// No suggestions for an empty argument prefix so Tab after "/autoresearch " does not
			// force-complete into off/clear; bare command submit toggles like /plan.
			if (normalized.length === 0) return null;
			const completions: AutocompleteItem[] = [
				{ label: "off", value: "off", description: "Leave autoresearch mode" },
				{ label: "clear", value: "clear", description: "Delete autoresearch.jsonl and leave autoresearch mode" },
			];
			const filtered = completions.filter(item => item.label.startsWith(normalized));
			return filtered.length > 0 ? filtered : null;
		},
		async handler(args, ctx): Promise<void> {
			const trimmed = args.trim();
			const runtime = getRuntime(ctx);
			const workDirError = validateWorkDir(ctx.cwd);
			if (workDirError) {
				ctx.ui.notify(workDirError, "error");
				return;
			}

			if ((trimmed === "" && runtime.autoresearchMode) || trimmed === "off" || trimmed === "clear") {
				if (trimmed === "clear") {
					const workDir = resolveWorkDir(ctx.cwd);
					fs.rmSync(path.join(workDir, "autoresearch.jsonl"), { force: true });
					fs.rmSync(path.join(workDir, ".autoresearch"), { force: true, recursive: true });
					runtime.state = createExperimentState();
					runtime.state.maxExperiments = readMaxExperiments(ctx.cwd);
					runtime.goal = null;
					applyPendingRunToRuntime(runtime, null);
				}
				const mode = trimmed === "clear" ? "clear" : "off";
				setMode(ctx, false, mode === "clear" ? null : runtime.goal, mode);
				dashboard.updateWidget(ctx, runtime);
				await api.setActiveTools(removeExperimentTools(api.getActiveTools()));
				ctx.ui.notify(mode === "clear" ? "Autoresearch local state cleared" : "Autoresearch mode disabled", "info");
				return;
			}

			const workDir = resolveWorkDir(ctx.cwd);
			const autoresearchMdPath = path.join(workDir, "autoresearch.md");
			const hasAutoresearchMd = fs.existsSync(autoresearchMdPath);
			const controlState = reconstructControlState(ctx.sessionManager.getBranch());
			const shouldResumeExistingNotes =
				hasAutoresearchMd &&
				(fs.existsSync(path.join(workDir, "autoresearch.jsonl")) ||
					fs.existsSync(path.join(workDir, ".autoresearch")) ||
					(controlState.lastMode !== "clear" && trimmed.length === 0));

			const goal = shouldResumeExistingNotes
				? (runtime.goal ?? runtime.state.name ?? null)
				: trimmed.length > 0
					? trimmed
					: null;
			const branchResult = await ensureAutoresearchBranch(api, workDir, goal);
			if (!branchResult.ok) {
				ctx.ui.notify(branchResult.error, "error");
				return;
			}

			setMode(ctx, true, goal, "on");
			dashboard.updateWidget(ctx, runtime);
			await api.setActiveTools(addExperimentTools(api.getActiveTools()));

			if (shouldResumeExistingNotes) {
				api.sendUserMessage(
					prompt.render(commandResumeTemplate, {
						autoresearch_md_path: autoresearchMdPath,
						branch_status_line: branchResult.created
							? `Created and checked out dedicated git branch \`${branchResult.branchName}\` before resuming.`
							: `Using dedicated git branch \`${branchResult.branchName}\`.`,
						has_resume_context: trimmed.length > 0,
						resume_context: trimmed,
					}),
				);
			} else if (trimmed.length > 0) {
				api.sendUserMessage(trimmed);
			} else {
				ctx.ui.notify("Autoresearch enabled\u2014describe what to optimize in your next message.", "info");
			}
		},
	});
	api.registerShortcut("ctrl+x", {
		description: "Toggle autoresearch dashboard",
		handler(ctx): void {
			const runtime = getRuntime(ctx);
			if (runtime.state.results.length === 0 && !runtime.runningExperiment) {
				ctx.ui.notify("No autoresearch results yet", "info");
				return;
			}
			runtime.dashboardExpanded = !runtime.dashboardExpanded;
			dashboard.updateWidget(ctx, runtime);
		},
	});
	api.registerShortcut("ctrl+shift+x", {
		description: "Show autoresearch dashboard overlay",
		handler(ctx): Promise<void> {
			return dashboard.showOverlay(ctx, getRuntime(ctx));
		},
	});
	api.on("session_start", (_event, ctx) => rehydrate(ctx));
	api.on("session_switch", (_event, ctx) => rehydrate(ctx));
	api.on("session_branch", (_event, ctx) => rehydrate(ctx));
	api.on("session_tree", (_event, ctx) => rehydrate(ctx));
	api.on("session_shutdown", (_event, ctx) => {
		dashboard.clear(ctx);
		runtimeStore.clear(getSessionKey(ctx));
	});
	api.on("agent_end", async (_event, ctx) => {
		const runtime = getRuntime(ctx);
		runtime.runningExperiment = null;
		dashboard.updateWidget(ctx, runtime);
		dashboard.requestRender();
		if (!runtime.autoresearchMode) return;
		if (ctx.hasPendingMessages()) {
			runtime.autoResumeArmed = false;
			return;
		}
		const workDir = resolveWorkDir(ctx.cwd);
		const pendingRun = await refreshPendingRun(runtime, workDir);
		const shouldResumePendingRun =
			pendingRun !== null && runtime.lastAutoResumePendingRunNumber !== pendingRun.runNumber;
		if (!shouldResumePendingRun && !runtime.autoResumeArmed) return;
		runtime.autoResumeArmed = false;
		runtime.lastAutoResumePendingRunNumber = pendingRun?.runNumber ?? null;
		const autoresearchMdPath = path.join(workDir, "autoresearch.md");
		const ideasPath = path.join(workDir, "autoresearch.ideas.md");
		api.sendMessage(
			{
				customType: "autoresearch-resume",
				content: prompt.render(resumeMessageTemplate, {
					autoresearch_md_path: autoresearchMdPath,
					has_ideas: fs.existsSync(ideasPath),
					has_pending_run: Boolean(pendingRun),
				}),
				display: false,
				attribution: "agent",
			},
			{ deliverAs: "nextTurn", triggerTurn: true },
		);
	});
	api.on("before_agent_start", async (event, ctx) => {
		const runtime = getRuntime(ctx);
		if (!runtime.autoresearchMode) return;
		const workDir = resolveWorkDir(ctx.cwd);
		const autoresearchMdPath = path.join(workDir, "autoresearch.md");
		const checksPath = path.join(workDir, "autoresearch.checks.sh");
		const ideasPath = path.join(workDir, "autoresearch.ideas.md");
		const pendingRun = await refreshPendingRun(runtime, workDir);
		const currentSegmentResults = currentResults(runtime.state.results, runtime.state.currentSegment);
		const baselineMetric = findBaselineMetric(runtime.state.results, runtime.state.currentSegment);
		const bestKept = findBestKeptResult(runtime.state);
		const goal = runtime.goal ?? runtime.state.name ?? "";
		const recentResults = currentSegmentResults.slice(-3).map(result => {
			const asiSummary = summarizeExperimentAsi(result);
			return {
				asi_summary: asiSummary,
				description: result.description,
				has_asi_summary: Boolean(asiSummary),
				metric_display: formatNum(result.metric, runtime.state.metricUnit),
				run_number: result.runNumber ?? runtime.state.results.indexOf(result) + 1,
				status: result.status,
			};
		});
		const hasPendingMetric = pendingRun?.parsedPrimary != null;
		return {
			systemPrompt: prompt.render(promptTemplate, {
				base_system_prompt: event.systemPrompt,
				has_goal: goal.trim().length > 0,
				goal,
				has_autoresearch_md: fs.existsSync(autoresearchMdPath),
				working_dir: workDir,
				default_metric_name: runtime.state.metricName,
				metric_name: runtime.state.metricName,
				autoresearch_md_path: autoresearchMdPath,
				has_checks: fs.existsSync(checksPath),
				checks_path: checksPath,
				has_ideas: fs.existsSync(ideasPath),
				ideas_path: ideasPath,
				current_segment: runtime.state.currentSegment + 1,
				current_segment_run_count: currentSegmentResults.length,
				has_baseline_metric: baselineMetric !== null,
				baseline_metric_display: formatNum(baselineMetric, runtime.state.metricUnit),
				has_best_result: Boolean(bestKept),
				best_metric_display: bestKept
					? formatNum(bestKept.result.metric, runtime.state.metricUnit)
					: formatNum(baselineMetric, runtime.state.metricUnit),
				best_run_number: bestKept ? (bestKept.result.runNumber ?? bestKept.index + 1) : null,
				has_recent_results: recentResults.length > 0,
				recent_results: recentResults,
				has_pending_run: Boolean(pendingRun),
				pending_run_number: pendingRun?.runNumber,
				pending_run_command: pendingRun?.command,
				pending_run_directory: pendingRun?.runDirectory,
				pending_run_passed: pendingRun?.passed ?? false,
				has_pending_run_metric: hasPendingMetric,
				pending_run_metric_display: hasPendingMetric
					? formatNum(pendingRun!.parsedPrimary!, runtime.state.metricUnit)
					: null,
			}),
		};
	});
};
function summarizeExperimentAsi(result: ExperimentResult): string | null {
	const parts = ["hypothesis", "rollback_reason", "next_action_hint"]
		.map(k => (typeof result.asi?.[k] === "string" ? (result.asi[k] as string).trim() : ""))
		.filter(Boolean);
	return parts.length > 0 ? parts.join(" | ").slice(0, 220) : null;
}
function resolveAutoresearchRelativePath(
	workDir: string,
	rawPath: string,
): { ok: false; reason: string } | { ok: true; relativePath: string } {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath))
		return { ok: false, reason: `Autoresearch cannot validate internal URL paths during scoped editing: ${rawPath}` };
	const resolvedPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(workDir, rawPath);
	const canonicalWorkDir = canonicalizeExistingPath(workDir);
	const canonicalTargetPath = canonicalizeTargetPath(resolvedPath);
	const relativePath = path.relative(canonicalWorkDir, canonicalTargetPath);
	if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath))
		return { ok: false, reason: `Autoresearch blocked edits outside the working tree: ${rawPath}` };
	return { ok: true, relativePath: relativePath.length === 0 ? "." : normalizeAutoresearchPath(relativePath) };
}
function validateEditableAutoresearchPath(relativePath: string, runtime: AutoresearchRuntime): string | null {
	if (isAutoresearchLocalStatePath(relativePath))
		return "autoresearch local state files are managed by the experiment tools and cannot be edited directly";
	if (runtime.state.offLimits.some(spec => pathMatchesContractPath(relativePath, spec)))
		return "this path is listed under Off Limits in autoresearch.md";
	if (isAutoresearchCommittableFile(relativePath)) return null;
	if (runtime.state.scopePaths.length === 0)
		return "Files in Scope is not initialized yet; only autoresearch control files may be edited before init_experiment runs";
	if (!runtime.state.scopePaths.some(spec => pathMatchesContractPath(relativePath, spec)))
		return "this path is outside Files in Scope in autoresearch.md";
	return null;
}
function collectLoggedRunNumbers(results: ExperimentResult[]): Set<number> {
	return new Set(results.map(r => r.runNumber).filter((n): n is number => n !== null));
}
function applyPendingRunToRuntime(runtime: AutoresearchRuntime, summary: PendingRunSummary | null): void {
	runtime.lastRunSummary = summary;
	runtime.lastRunChecks = summaryToChecks(summary);
	runtime.lastRunDuration = summary?.durationSeconds ?? null;
	runtime.lastRunAsi = summary?.parsedAsi ?? null;
	runtime.lastRunArtifactDir = summary?.runDirectory ?? null;
	runtime.lastRunNumber = summary?.runNumber ?? null;
}
function summaryToChecks(summary: PendingRunSummary | null): AutoresearchRuntime["lastRunChecks"] {
	if (!summary || summary.checksPass === null) return null;
	return {
		pass: summary.checksPass,
		output: "",
		duration: summary.checksDurationSeconds ?? 0,
	};
}
function canonicalizeExistingPath(targetPath: string): string {
	try {
		return fs.realpathSync.native(targetPath);
	} catch {
		return path.resolve(targetPath);
	}
}
function canonicalizeTargetPath(targetPath: string): string {
	const pendingSegments: string[] = [];
	let currentPath = path.resolve(targetPath);
	while (!fs.existsSync(currentPath)) {
		const parentPath = path.dirname(currentPath);
		if (parentPath === currentPath) return currentPath;
		pendingSegments.unshift(path.basename(currentPath));
		currentPath = parentPath;
	}
	return path.resolve(canonicalizeExistingPath(currentPath), ...pendingSegments);
}
async function refreshPendingRun(runtime: AutoresearchRuntime, workDir: string): Promise<PendingRunSummary | null> {
	const pendingRun =
		runtime.lastRunSummary ?? (await readPendingRunSummary(workDir, collectLoggedRunNumbers(runtime.state.results)));
	runtime.lastRunSummary = pendingRun;
	runtime.lastRunChecks = summaryToChecks(pendingRun);
	runtime.lastRunDuration = pendingRun?.durationSeconds ?? runtime.lastRunDuration;
	runtime.lastRunAsi = pendingRun?.parsedAsi ?? runtime.lastRunAsi;
	return pendingRun;
}
