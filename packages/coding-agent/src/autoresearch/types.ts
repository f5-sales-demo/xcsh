import type { ExtensionAPI, ExtensionContext } from "../extensibility/extensions";
import type { TruncationResult } from "../session/streaming-output";

export type MetricDirection = "lower" | "higher";
export type ExperimentStatus = "keep" | "discard" | "crash" | "checks_failed";
export type ASIValue = string | number | boolean | null | ASIValue[] | { [key: string]: ASIValue };
export type ASIData = Record<string, ASIValue>;
export type NumericMetricMap = Record<string, number>;
export type MetricDef = { name: string; unit: string };
export interface AutoresearchContract extends Pick<ExperimentState, "scopePaths" | "offLimits" | "constraints"> {
	benchmark: {
		command: string | null;
		primaryMetric: string | null;
		metricUnit: string;
		direction: MetricDirection | null;
		secondaryMetrics: string[];
	};
}
export interface ExperimentResult {
	runNumber: number | null;
	commit: string;
	metric: number;
	metrics: NumericMetricMap;
	status: ExperimentStatus;
	description: string;
	timestamp: number;
	segment: number;
	confidence: number | null;
	asi?: ASIData;
}
export interface ExperimentState {
	results: ExperimentResult[];
	bestMetric: number | null;
	bestDirection: MetricDirection;
	metricName: string;
	metricUnit: string;
	secondaryMetrics: MetricDef[];
	name: string | null;
	currentSegment: number;
	maxExperiments: number | null;
	confidence: number | null;
	benchmarkCommand: string | null;
	scopePaths: string[];
	offLimits: string[];
	constraints: string[];
}
export interface RunExperimentProgressDetails extends Pick<RunDetails, "truncation" | "fullOutputPath"> {
	phase: "running";
	elapsed: string;
	runDirectory?: string;
}
interface RunDataBase {
	checksPass: boolean | null;
	checksTimedOut: boolean;
	command: string;
	parsedAsi: ASIData | null;
	parsedMetrics: NumericMetricMap | null;
	parsedPrimary: number | null;
	passed: boolean;
	preRunDirtyPaths: string[];
	runDirectory: string;
	runNumber: number;
}
export interface RunDetails extends RunDataBase, Pick<ExperimentState, "metricName" | "metricUnit"> {
	benchmarkLogPath: string;
	checksLogPath?: string;
	exitCode: number | null;
	durationSeconds: number;
	crashed: boolean;
	timedOut: boolean;
	tailOutput: string;
	checksOutput: string;
	checksDuration: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}
export type LogDetails = { experiment: ExperimentResult; state: ExperimentState; wallClockSeconds: number | null };
export type PendingRunSummary = RunDataBase & { checksDurationSeconds: number | null; durationSeconds: number | null };
export interface AutoresearchRuntime {
	autoresearchMode: boolean;
	autoResumeArmed: boolean;
	dashboardExpanded: boolean;
	lastAutoResumePendingRunNumber: number | null;
	lastRunChecks: { pass: boolean; output: string; duration: number } | null;
	lastRunDuration: number | null;
	lastRunAsi: ASIData | null;
	lastRunArtifactDir: string | null;
	lastRunNumber: number | null;
	lastRunSummary: PendingRunSummary | null;
	runningExperiment: { startedAt: number; command: string; runDirectory: string; runNumber: number } | null;
	state: ExperimentState;
	goal: string | null;
}
export interface DashboardController {
	clear(ctx: ExtensionContext): void;
	requestRender(): void;
	showOverlay(ctx: ExtensionContext, runtime: AutoresearchRuntime): Promise<void>;
	updateWidget(ctx: ExtensionContext, runtime: AutoresearchRuntime): void;
}
export interface AutoresearchToolFactoryOptions {
	dashboard: DashboardController;
	getRuntime(ctx: ExtensionContext): AutoresearchRuntime;
	pi: ExtensionAPI;
}
