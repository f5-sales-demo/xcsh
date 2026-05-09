import type { AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "../extensibility/extensions";
import type { TruncationResult } from "../session/streaming-output";

export type MetricDirection = "lower" | "higher";
export type ExperimentStatus = "keep" | "discard" | "crash" | "checks_failed";

export type ASIValue = string | number | boolean | null | ASIValue[] | { [key: string]: ASIValue };

export interface ASIData {
	[key: string]: ASIValue;
}

export interface NumericMetricMap {
	[key: string]: number;
}

export interface MetricDef {
	name: string;
	unit: string;
}

export interface AutoresearchContract {
	benchmark: {
		command: string | null;
		primaryMetric: string | null;
		metricUnit: string;
		direction: MetricDirection | null;
		secondaryMetrics: string[];
	};
	scopePaths: string[];
	offLimits: string[];
	constraints: string[];
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

export interface RunExperimentProgressDetails {
	phase: "running";
	elapsed: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
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

export interface RunDetails extends RunDataBase {
	benchmarkLogPath: string;
	checksLogPath?: string;
	exitCode: number | null;
	durationSeconds: number;
	crashed: boolean;
	timedOut: boolean;
	tailOutput: string;
	checksOutput: string;
	checksDuration: number;
	metricName: string;
	metricUnit: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

export interface LogDetails {
	experiment: ExperimentResult;
	state: ExperimentState;
	wallClockSeconds: number | null;
}

export interface PendingRunSummary extends RunDataBase {
	checksDurationSeconds: number | null;
	durationSeconds: number | null;
}

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

export type AutoresearchToolResult<TDetails> = AgentToolResult<TDetails>;
