import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionEntry } from "../session/session-manager";
import { normalizeAutoresearchList, normalizeContractPathSpec } from "./contract";
import { cloneNumericMetricMap, DENIED_KEY_NAMES, finiteOrNull, inferMetricUnitFromName, isBetter } from "./helpers";
import type * as T from "./types";

interface AutoresearchJsonConfigEntry
	extends Partial<Pick<T.AutoresearchContract, "scopePaths" | "offLimits" | "constraints">>,
		Partial<Pick<T.ExperimentState, "metricName" | "metricUnit" | "bestDirection">> {
	type: "config";
	name?: string;
	benchmarkCommand?: string;
	secondaryMetrics?: string[];
}
type AutoresearchControlEntryData = { mode: "on" | "off" | "clear"; goal?: string };
interface ReconstructedControlState {
	autoresearchMode: boolean;
	goal: string | null;
	lastMode: AutoresearchControlEntryData["mode"] | null;
}
type RuntimeStore = { clear(sessionKey: string): void; ensure(sessionKey: string): T.AutoresearchRuntime };
export function createExperimentState(): T.ExperimentState {
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
export function createSessionRuntime(): T.AutoresearchRuntime {
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
export const cloneExperimentState = (state: T.ExperimentState): T.ExperimentState => structuredClone(state);
export const currentResults = (results: T.ExperimentResult[], segment: number): T.ExperimentResult[] =>
	results.filter(result => result.segment === segment);
export const findBaselineResult = (results: T.ExperimentResult[], segment: number): T.ExperimentResult | null =>
	currentResults(results, segment).find(result => result.status === "keep") ?? null;
export const findBaselineMetric = (results: T.ExperimentResult[], segment: number): number | null =>
	findBaselineResult(results, segment)?.metric ?? null;
export function findBestKeptMetric(
	results: T.ExperimentResult[],
	segment: number,
	direction: T.MetricDirection,
): number | null {
	let best: number | null = null;
	for (const result of currentResults(results, segment)) {
		if (result.status !== "keep") continue;
		if (best === null || isBetter(result.metric, best, direction)) best = result.metric;
	}
	return best;
}
export function findBestKeptResult(state: T.ExperimentState): { index: number; result: T.ExperimentResult } | null {
	let best: { index: number; result: T.ExperimentResult } | null = null;
	for (let index = 0; index < state.results.length; index += 1) {
		const result = state.results[index];
		if (result.segment !== state.currentSegment || result.status !== "keep" || result.metric <= 0) continue;
		if (!best || isBetter(result.metric, best.result.metric, state.bestDirection)) best = { index, result };
	}
	return best;
}
export function findBaselineSecondary(
	results: T.ExperimentResult[],
	segment: number,
	knownMetrics: T.MetricDef[],
): T.NumericMetricMap {
	const baseline = findBaselineResult(results, segment);
	const values: T.NumericMetricMap = baseline ? { ...baseline.metrics } : {};
	const current = currentResults(results, segment);
	for (const metric of knownMetrics) {
		if (values[metric.name] !== undefined) continue;
		const found = current.find(r => r.metrics[metric.name] !== undefined);
		if (found) values[metric.name] = found.metrics[metric.name];
	}
	return values;
}
function sortedMedian(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
export function computeConfidence(
	results: T.ExperimentResult[],
	segment: number,
	direction: T.MetricDirection,
): number | null {
	const current = currentResults(results, segment).filter(result => result.metric > 0);
	if (current.length < 3) return null;
	const values = current.map(result => result.metric);
	const median = sortedMedian(values);
	const mad = sortedMedian(values.map(value => Math.abs(value - median)));
	if (mad === 0) return null;
	const baseline = findBaselineMetric(results, segment);
	if (baseline === null) return null;
	const bestKept = findBestKeptMetric(results, segment, direction);
	return bestKept === null || bestKept <= 0 || bestKept === baseline ? null : Math.abs(bestKept - baseline) / mad;
}
export function reconstructStateFromJsonl(workDir: string): { hasLog: boolean; state: T.ExperimentState } {
	const state = createExperimentState();
	const jsonlPath = path.join(workDir, "autoresearch.jsonl");
	if (!fs.existsSync(jsonlPath)) return { hasLog: false, state };
	let segment = 0;
	let sawConfig = false;
	for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line) as unknown;
		} catch {
			continue;
		}
		const configEntry = parseConfigEntry(parsed);
		if (configEntry) {
			if (sawConfig || state.results.length > 0) segment += 1;
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
			state.secondaryMetrics = (configEntry.secondaryMetrics ?? []).map(name => ({
				name,
				unit: inferMetricUnitFromName(name),
			}));
			continue;
		}
		if (typeof parsed !== "object" || parsed === null) continue;
		const entry = parsed as Record<string, unknown>;
		if (entry.type !== undefined && entry.type !== "run") continue;
		const result: T.ExperimentResult = {
			runNumber: finiteOrNull(entry.run),
			commit: typeof entry.commit === "string" ? entry.commit : "",
			metric: finiteOrNull(entry.metric) ?? 0,
			metrics: cloneNumericMetricMap(entry.metrics) ?? {},
			status: isExperimentStatus(entry.status) ? entry.status : "keep",
			description: typeof entry.description === "string" ? entry.description : "",
			timestamp: finiteOrNull(entry.timestamp) ?? 0,
			segment,
			confidence: finiteOrNull(entry.confidence),
			asi: cloneAsi(entry.asi),
		};
		state.results.push(result);
		if (segment !== state.currentSegment) continue;
		const known = new Set(state.secondaryMetrics.map(m => m.name));
		for (const name of Object.keys(result.metrics))
			if (!known.has(name)) state.secondaryMetrics.push({ name, unit: inferMetricUnitFromName(name) });
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
		if (typeof entry.data !== "object" || entry.data === null) continue;
		const d = entry.data as { goal?: unknown; mode?: unknown };
		if (d.mode !== "on" && d.mode !== "off" && d.mode !== "clear") continue;
		const data: AutoresearchControlEntryData = { mode: d.mode, ...(nonEmpty(d.goal) && { goal: d.goal }) };
		lastMode = data.mode;
		autoresearchMode = data.mode === "on";
		goal = data.goal ?? goal;
		if (data.mode === "clear") goal = null;
	}
	return { autoresearchMode, goal, lastMode };
}
export function createRuntimeStore(): RuntimeStore {
	const runtimes = new Map<string, T.AutoresearchRuntime>();
	return {
		clear(sessionKey: string): void {
			runtimes.delete(sessionKey);
		},
		ensure(sessionKey: string): T.AutoresearchRuntime {
			if (!runtimes.has(sessionKey)) runtimes.set(sessionKey, createSessionRuntime());
			return runtimes.get(sessionKey)!;
		},
	};
}
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function parseConfigEntry(value: unknown): AutoresearchJsonConfigEntry | null {
	if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "config") return null;
	const candidate = value as AutoresearchJsonConfigEntry;
	const config: AutoresearchJsonConfigEntry = { type: "config" };
	if (nonEmpty(candidate.name)) config.name = candidate.name;
	if (nonEmpty(candidate.metricName)) config.metricName = candidate.metricName;
	if (typeof candidate.metricUnit === "string") config.metricUnit = candidate.metricUnit;
	if (candidate.bestDirection === "lower" || candidate.bestDirection === "higher")
		config.bestDirection = candidate.bestDirection;
	if (nonEmpty(candidate.benchmarkCommand)) config.benchmarkCommand = candidate.benchmarkCommand;
	config.secondaryMetrics = parseNormalizedStringList(candidate.secondaryMetrics);
	config.scopePaths = parseNormalizedStringList(candidate.scopePaths, normalizeContractPathSpec);
	config.offLimits = parseNormalizedStringList(candidate.offLimits, normalizeContractPathSpec);
	config.constraints = parseNormalizedStringList(candidate.constraints);
	return config;
}
const isExperimentStatus = (value: unknown): value is T.ExperimentResult["status"] =>
	value === "keep" || value === "discard" || value === "crash" || value === "checks_failed";
function parseNormalizedStringList(value: unknown, normalize?: (v: string) => string): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const filtered = value.filter((item): item is string => typeof item === "string");
	return normalizeAutoresearchList(normalize ? filtered.map(normalize) : filtered);
}
function cloneAsi(value: unknown): T.ExperimentResult["asi"] {
	if (typeof value !== "object" || value === null) return undefined;
	const clone = structuredClone(value as Record<string, unknown>);
	for (const key of DENIED_KEY_NAMES) delete clone[key];
	return clone as T.ExperimentResult["asi"];
}
