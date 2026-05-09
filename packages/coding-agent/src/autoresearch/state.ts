import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionEntry } from "../session/session-manager";
import { normalizeAutoresearchList, normalizeContractPathSpec } from "./contract";
import { inferMetricUnitFromName, isBetter } from "./helpers";
import type {
	ASIData,
	AutoresearchRuntime,
	ExperimentResult,
	ExperimentState,
	ExperimentStatus,
	MetricDef,
	MetricDirection,
	NumericMetricMap,
} from "./types";

interface AutoresearchJsonConfigEntry {
	type: "config";
	name?: string;
	metricName?: string;
	metricUnit?: string;
	bestDirection?: MetricDirection;
	benchmarkCommand?: string;
	secondaryMetrics?: string[];
	scopePaths?: string[];
	offLimits?: string[];
	constraints?: string[];
}

interface AutoresearchJsonRunEntry {
	run?: number;
	commit?: string;
	metric?: number;
	metrics?: NumericMetricMap;
	status?: ExperimentStatus;
	description?: string;
	timestamp?: number;
	confidence?: number | null;
	asi?: ASIData;
}

interface ReconstructedExperimentData {
	hasLog: boolean;
	state: ExperimentState;
}

interface AutoresearchControlEntryData {
	mode: "on" | "off" | "clear";
	goal?: string;
}

interface ReconstructedControlState {
	autoresearchMode: boolean;
	goal: string | null;
	lastMode: AutoresearchControlEntryData["mode"] | null;
}

interface RuntimeStore {
	clear(sessionKey: string): void;
	ensure(sessionKey: string): AutoresearchRuntime;
}
function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createExperimentState(): ExperimentState {
	return {
		results: [],
		bestMetric: null,
		bestDirection: "lower",
		metricName: "metric",
		metricUnit: "",
		secondaryMetrics: [],
		name: null,
		currentSegment: 0,
		maxExperiments: null,
		confidence: null,
		benchmarkCommand: null,
		scopePaths: [],
		offLimits: [],
		constraints: [],
	};
}

export function createSessionRuntime(): AutoresearchRuntime {
	return {
		autoresearchMode: false,
		autoResumeArmed: false,
		dashboardExpanded: false,
		lastAutoResumePendingRunNumber: null,
		lastRunChecks: null,
		lastRunDuration: null,
		lastRunAsi: null,
		lastRunArtifactDir: null,
		lastRunNumber: null,
		lastRunSummary: null,
		runningExperiment: null,
		state: createExperimentState(),
		goal: null,
	};
}

export function cloneExperimentState(state: ExperimentState): ExperimentState {
	return structuredClone(state);
}

export function currentResults(results: ExperimentResult[], segment: number): ExperimentResult[] {
	return results.filter(result => result.segment === segment);
}

function findBaselineResult(results: ExperimentResult[], segment: number): ExperimentResult | null {
	return currentResults(results, segment).find(result => result.status === "keep") ?? null;
}

export function findBaselineMetric(results: ExperimentResult[], segment: number): number | null {
	const baseline = findBaselineResult(results, segment);
	return baseline ? baseline.metric : null;
}

export function findBestKeptMetric(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
): number | null {
	let best: number | null = null;
	for (const result of currentResults(results, segment)) {
		if (result.status !== "keep") continue;
		if (best === null || isBetter(result.metric, best, direction)) {
			best = result.metric;
		}
	}
	return best;
}

export function findBaselineRunNumber(results: ExperimentResult[], segment: number): number | null {
	const baseline = findBaselineResult(results, segment);
	if (!baseline) return null;
	if (baseline.runNumber !== null) return baseline.runNumber;
	const index = results.indexOf(baseline);
	return index >= 0 ? index + 1 : null;
}

export function findBaselineSecondary(
	results: ExperimentResult[],
	segment: number,
	knownMetrics: MetricDef[],
): NumericMetricMap {
	const baseline = findBaselineResult(results, segment);
	const values: NumericMetricMap = baseline ? { ...baseline.metrics } : {};
	for (const metric of knownMetrics) {
		if (values[metric.name] !== undefined) continue;
		for (const result of currentResults(results, segment)) {
			const value = result.metrics[metric.name];
			if (value !== undefined) {
				values[metric.name] = value;
				break;
			}
		}
	}
	return values;
}

function sortedMedian(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const midpoint = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
	}
	return sorted[midpoint];
}

export function computeConfidence(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
): number | null {
	const current = currentResults(results, segment).filter(result => result.metric > 0);
	if (current.length < 3) return null;

	const values = current.map(result => result.metric);
	const median = sortedMedian(values);
	const mad = sortedMedian(values.map(value => Math.abs(value - median)));
	if (mad === 0) return null;

	const baseline = findBaselineMetric(results, segment);
	if (baseline === null) return null;

	let bestKept: number | null = null;
	for (const result of current) {
		if (result.status !== "keep" || result.metric <= 0) continue;
		if (bestKept === null || isBetter(result.metric, bestKept, direction)) {
			bestKept = result.metric;
		}
	}
	if (bestKept === null || bestKept === baseline) return null;

	return Math.abs(bestKept - baseline) / mad;
}

export function reconstructStateFromJsonl(workDir: string): ReconstructedExperimentData {
	const state = createExperimentState();
	const jsonlPath = path.join(workDir, "autoresearch.jsonl");
	if (!fs.existsSync(jsonlPath)) {
		return { hasLog: false, state };
	}

	const content = fs.readFileSync(jsonlPath, "utf8");
	const lines = content
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0);

	let segment = 0;
	let sawConfig = false;
	for (const line of lines) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line) as unknown;
		} catch {
			continue;
		}

		const configEntry = parseConfigEntry(parsed);
		if (configEntry) {
			if (sawConfig || state.results.length > 0) {
				segment += 1;
			}
			sawConfig = true;
			state.currentSegment = segment;
			if (configEntry.name) state.name = configEntry.name;
			if (configEntry.metricName) state.metricName = configEntry.metricName;
			if (configEntry.metricUnit !== undefined) state.metricUnit = configEntry.metricUnit;
			if (configEntry.bestDirection) state.bestDirection = configEntry.bestDirection;
			if (configEntry.benchmarkCommand !== undefined) state.benchmarkCommand = configEntry.benchmarkCommand;
			state.scopePaths = [...(configEntry.scopePaths ?? [])];
			state.offLimits = [...(configEntry.offLimits ?? [])];
			state.constraints = [...(configEntry.constraints ?? [])];
			state.secondaryMetrics = hydrateMetricDefs(configEntry.secondaryMetrics);
			continue;
		}

		if (!isRunEntry(parsed)) continue;
		const result: ExperimentResult = {
			runNumber: finiteOrNull(parsed.run),
			commit: typeof parsed.commit === "string" ? parsed.commit : "",
			metric: finiteOrNull(parsed.metric) ?? 0,
			metrics: cloneNumericMetrics(parsed.metrics),
			status: isExperimentStatus(parsed.status) ? parsed.status : "keep",
			description: typeof parsed.description === "string" ? parsed.description : "",
			timestamp: finiteOrNull(parsed.timestamp) ?? 0,
			segment,
			confidence: finiteOrNull(parsed.confidence),
			asi: cloneAsi(parsed.asi),
		};
		state.results.push(result);
		if (segment !== state.currentSegment) continue;
		registerSecondaryMetrics(state.secondaryMetrics, result.metrics);
	}

	state.bestMetric = findBaselineMetric(state.results, state.currentSegment);
	state.confidence = computeConfidence(state.results, state.currentSegment, state.bestDirection);
	return { hasLog: true, state };
}

export function reconstructControlState(entries: SessionEntry[]): ReconstructedControlState {
	let autoresearchMode = false;
	let goal: string | null = null;
	let lastMode: ReconstructedControlState["lastMode"] = null;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== "autoresearch-control") continue;
		const data = parseControlEntry(entry.data);
		if (!data) continue;
		lastMode = data.mode;
		autoresearchMode = data.mode === "on";
		goal = data.goal ?? goal;
		if (data.mode === "clear") {
			goal = null;
		}
	}
	return { autoresearchMode, goal, lastMode };
}

export function createRuntimeStore(): RuntimeStore {
	const runtimes = new Map<string, AutoresearchRuntime>();
	return {
		clear(sessionKey: string): void {
			runtimes.delete(sessionKey);
		},
		ensure(sessionKey: string): AutoresearchRuntime {
			const existing = runtimes.get(sessionKey);
			if (existing) return existing;
			const runtime = createSessionRuntime();
			runtimes.set(sessionKey, runtime);
			return runtime;
		},
	};
}

function registerSecondaryMetrics(metrics: MetricDef[], values: NumericMetricMap): void {
	for (const name of Object.keys(values)) {
		if (metrics.some(metric => metric.name === name)) continue;
		metrics.push({
			name,
			unit: inferMetricUnitFromName(name),
		});
	}
}

function isConfigEntry(value: unknown): value is AutoresearchJsonConfigEntry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { type?: unknown };
	return candidate.type === "config";
}

function parseConfigEntry(value: unknown): AutoresearchJsonConfigEntry | null {
	if (!isConfigEntry(value)) return null;
	const candidate = value as AutoresearchJsonConfigEntry;
	const config: AutoresearchJsonConfigEntry = { type: "config" };
	if (typeof candidate.name === "string" && candidate.name.trim().length > 0) {
		config.name = candidate.name;
	}
	if (typeof candidate.metricName === "string" && candidate.metricName.trim().length > 0) {
		config.metricName = candidate.metricName;
	}
	if (typeof candidate.metricUnit === "string") {
		config.metricUnit = candidate.metricUnit;
	}
	if (candidate.bestDirection === "lower" || candidate.bestDirection === "higher") {
		config.bestDirection = candidate.bestDirection;
	}
	if (typeof candidate.benchmarkCommand === "string" && candidate.benchmarkCommand.trim().length > 0) {
		config.benchmarkCommand = candidate.benchmarkCommand;
	}
	config.secondaryMetrics = parseNormalizedStringList(candidate.secondaryMetrics);
	config.scopePaths = parseNormalizedStringList(candidate.scopePaths, normalizeContractPathSpec);
	config.offLimits = parseNormalizedStringList(candidate.offLimits, normalizeContractPathSpec);
	config.constraints = parseNormalizedStringList(candidate.constraints);
	return config;
}

function isRunEntry(value: unknown): value is AutoresearchJsonRunEntry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { type?: unknown };
	return candidate.type === undefined || candidate.type === "run";
}

function isExperimentStatus(value: unknown): value is ExperimentResult["status"] {
	return value === "keep" || value === "discard" || value === "crash" || value === "checks_failed";
}

function cloneNumericMetrics(value: unknown): NumericMetricMap {
	if (typeof value !== "object" || value === null) return {};
	const clone: NumericMetricMap = {};
	for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		const num = finiteOrNull(entryValue);
		if (num !== null) clone[key] = num;
	}
	return clone;
}
function parseNormalizedStringList(value: unknown, normalize?: (v: string) => string): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const filtered = value.filter((item): item is string => typeof item === "string");
	return normalizeAutoresearchList(normalize ? filtered.map(normalize) : filtered);
}

function hydrateMetricDefs(metricNames: string[] | undefined): MetricDef[] {
	if (!metricNames) return [];
	return metricNames.map(name => ({
		name,
		unit: inferMetricUnitFromName(name),
	}));
}

function cloneAsi(value: unknown): ExperimentResult["asi"] {
	if (typeof value !== "object" || value === null) return undefined;
	const clone = structuredClone(value as Record<string, unknown>);
	for (const key of ["__proto__", "constructor", "prototype"]) delete clone[key];
	return clone as ExperimentResult["asi"];
}

function parseControlEntry(value: unknown): AutoresearchControlEntryData | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as { goal?: unknown; mode?: unknown };
	if (candidate.mode !== "on" && candidate.mode !== "off" && candidate.mode !== "clear") return null;
	const data: AutoresearchControlEntryData = { mode: candidate.mode };
	if (typeof candidate.goal === "string" && candidate.goal.trim().length > 0) {
		data.goal = candidate.goal;
	}
	return data;
}
