import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent } from "@f5xc-salesdemos/pi-utils";
import { parseCommandArgs } from "../utils/command-args";
import type { ASIData, ASIValue, MetricDirection, NumericMetricMap, PendingRunSummary } from "./types";

export const EXPERIMENT_MAX_LINES = 10;
export const EXPERIMENT_MAX_BYTES = 4 * 1024;
const AUTORESEARCH_COMMITTABLE_FILES = new Set([
	"autoresearch.md",
	"autoresearch.sh",
	"autoresearch.checks.sh",
	"autoresearch.ideas.md",
]);

const DENIED_KEY_NAMES = new Set(["__proto__", "constructor", "prototype"]);

function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseMetricLines(output: string): Map<string, number> {
	const metrics = new Map<string, number>();
	for (const [, name, raw] of output.matchAll(/^METRIC\s+([\w.µ-]+)=(\S+)\s*$/gm)) {
		if (name && !DENIED_KEY_NAMES.has(name)) {
			const value = Number(raw);
			if (Number.isFinite(value)) metrics.set(name, value);
		}
	}
	return metrics;
}

export function parseAsiLines(output: string): ASIData | null {
	const asi: ASIData = {};
	for (const [, key, raw] of output.matchAll(/^ASI\s+([\w.-]+)=(.+)\s*$/gm)) {
		if (key && !DENIED_KEY_NAMES.has(key)) asi[key] = parseAsiValue(raw);
	}
	return Object.keys(asi).length > 0 ? asi : null;
}

function parseAsiValue(raw: string): ASIValue {
	const value = raw.trim();
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(value)) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	if (value.startsWith("{") || value.startsWith("[") || value.startsWith('"')) {
		try {
			return JSON.parse(value) as ASIValue;
		} catch {
			return value;
		}
	}
	return value;
}

export function mergeAsi(base: ASIData | null, override: ASIData | undefined): ASIData | undefined {
	if (!base && !override) return undefined;
	return {
		...(base ?? {}),
		...(override ?? {}),
	};
}

function commas(value: number): string {
	const sign = value < 0 ? "-" : "";
	const digits = String(Math.trunc(Math.abs(value)));
	const groups: string[] = [];
	for (let index = digits.length; index > 0; index -= 3) {
		groups.unshift(digits.slice(Math.max(0, index - 3), index));
	}
	return sign + groups.join(",");
}

function fmtNum(value: number, decimals: number = 0): string {
	if (decimals <= 0) return commas(Math.round(value));
	const absolute = Math.abs(value);
	const whole = Math.floor(absolute);
	const fraction = (absolute - whole).toFixed(decimals).slice(1);
	return `${value < 0 ? "-" : ""}${commas(whole)}${fraction}`;
}

export function formatNum(value: number | null, unit: string): string {
	return value === null ? "-" : `${fmtNum(value, Number.isInteger(value) ? 0 : 2)}${unit}`;
}

export function formatElapsed(milliseconds: number): string {
	const s = Math.floor(milliseconds / 1000);
	return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export function getAutoresearchRunDirectory(workDir: string, runNumber: number): string {
	return path.join(workDir, ".autoresearch", "runs", String(runNumber).padStart(4, "0"));
}

export function getNextAutoresearchRunNumber(workDir: string, lastRunNumber: number | null): number {
	const runsDirectory = path.join(workDir, ".autoresearch", "runs");
	let maxRunNumber = lastRunNumber ?? 0;
	try {
		for (const entry of fs.readdirSync(runsDirectory, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const n = Number.parseInt(entry.name, 10);
			if (Number.isFinite(n)) maxRunNumber = Math.max(maxRunNumber, n);
		}
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}
	return maxRunNumber + 1;
}

export function normalizeAutoresearchPath(relativePath: string): string {
	const normalized = relativePath.replaceAll("\\", "/").trim();
	if (normalized === "." || normalized === "./") return ".";
	return normalized.replace(/^\.\/+/, "").replace(/\/+$/, "");
}

export function isAutoresearchCommittableFile(relativePath: string): boolean {
	return AUTORESEARCH_COMMITTABLE_FILES.has(normalizeAutoresearchPath(relativePath));
}

export function isAutoresearchLocalStatePath(relativePath: string): boolean {
	const normalized = normalizeAutoresearchPath(relativePath);
	return (
		normalized === "autoresearch.jsonl" || normalized === ".autoresearch" || normalized.startsWith(".autoresearch/")
	);
}

export function killTree(pid: number, signal: NodeJS.Signals | number = "SIGTERM"): void {
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// Process already exited.
		}
	}
}

export function isAutoresearchShCommand(command: string): boolean {
	const normalized = command
		.trim()
		.replace(/^(?:\w+=\S*\s+)+/, "")
		.replace(/^(?:(?:env|time|nice|nohup)(?:\s+-\S+(?:\s+\d+)?)?\s+)*/, "");
	if (/[;&|<>]/.test(normalized)) return false;

	const tokens = parseCommandArgs(normalized);
	if (tokens.length === 0) return false;

	let index = 0;
	if (tokens[index] === "bash" || tokens[index] === "sh") {
		index += 1;
		while (index < tokens.length && tokens[index]?.startsWith("-")) {
			if (tokens[index]?.includes("c")) return false;
			index += 1;
		}
	}

	const scriptToken = tokens[index];
	if (!scriptToken || !/^(?:\.\/|\/[\w/.-]*\/)?autoresearch\.sh$/.test(scriptToken)) return false;

	return !tokens
		.slice(index + 1)
		.some(t => t === "&&" || t === "||" || t === ";" || t === "|" || t === ">" || t === "<");
}

export function isBetter(current: number, best: number, direction: MetricDirection): boolean {
	return direction === "lower" ? current < best : current > best;
}

export function inferMetricUnitFromName(name: string): string {
	if (name.endsWith("µs") || name.endsWith("_µs")) return "µs";
	if (name.endsWith("ms") || name.endsWith("_ms")) return "ms";
	if (name.endsWith("_s") || name.endsWith("_sec") || name.endsWith("_secs")) return "s";
	if (name.endsWith("_kb") || name.endsWith("kb")) return "kb";
	if (name.endsWith("_mb") || name.endsWith("mb")) return "mb";
	return "";
}

export async function readPendingRunSummary(
	workDir: string,
	loggedRunNumbers: ReadonlySet<number> = new Set<number>(),
): Promise<PendingRunSummary | null> {
	const entries = await readRunDirectoryEntries(workDir);
	if (!entries) return null;

	const runDirectories = entries
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.sort((left, right) => right.localeCompare(left));

	for (const directoryName of runDirectories) {
		const { parsed, runDirectory } = await readRunArtifact(workDir, directoryName);
		if (!parsed) continue;
		const pendingRun = parsePendingRunSummary(parsed, runDirectory, directoryName, loggedRunNumbers);
		if (pendingRun) return pendingRun;
	}

	return null;
}

export async function abandonUnloggedAutoresearchRuns(
	workDir: string,
	loggedRunNumbers: ReadonlySet<number>,
): Promise<number> {
	const entries = await readRunDirectoryEntries(workDir);
	if (!entries) return 0;

	let abandoned = 0;
	const stamp = new Date().toISOString();
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const directoryName = entry.name;
		const { parsed, runDirectory, runJsonPath } = await readRunArtifact(workDir, directoryName);
		if (!parsed) continue;

		const pending = parsePendingRunSummary(parsed, runDirectory, directoryName, loggedRunNumbers);
		if (!pending) continue;

		const existing = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
		await Bun.write(runJsonPath, JSON.stringify({ ...existing, abandonedAt: stamp }, null, 2));
		abandoned += 1;
	}

	return abandoned;
}

async function readRunDirectoryEntries(workDir: string): Promise<fs.Dirent[] | null> {
	const runsDir = path.join(workDir, ".autoresearch", "runs");
	try {
		return await fs.promises.readdir(runsDir, { withFileTypes: true });
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
}

async function readRunArtifact(
	workDir: string,
	directoryName: string,
): Promise<{ parsed: unknown; runDirectory: string; runJsonPath: string }> {
	const runDirectory = path.join(workDir, ".autoresearch", "runs", directoryName);
	const runJsonPath = path.join(runDirectory, "run.json");
	try {
		const parsed = await Bun.file(runJsonPath).json();
		return { parsed, runDirectory, runJsonPath };
	} catch (error) {
		if (isEnoent(error)) return { parsed: null, runDirectory, runJsonPath };
		throw error;
	}
}

function readConfig(cwd: string) {
	const configPath = path.join(cwd, "autoresearch.config.json");
	try {
		const raw = fs.readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) return {};
		const candidate = parsed as { maxIterations?: unknown; workingDir?: unknown };
		const config: { maxIterations?: number; workingDir?: string } = {};
		const maxIter = finiteOrNull(candidate.maxIterations);
		if (maxIter !== null) config.maxIterations = maxIter;
		if (typeof candidate.workingDir === "string" && candidate.workingDir.trim().length > 0)
			config.workingDir = candidate.workingDir;
		return config;
	} catch (error) {
		if (isEnoent(error)) return {};
		return {};
	}
}

export function readMaxExperiments(cwd: string): number | null {
	const value = readConfig(cwd).maxIterations;
	return value !== undefined && value > 0 ? Math.floor(value) : null;
}

export function resolveWorkDir(cwd: string): string {
	const configured = readConfig(cwd).workingDir;
	if (!configured) return cwd;
	return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
}

export function validateWorkDir(cwd: string): string | null {
	const workDir = resolveWorkDir(cwd);
	try {
		if (!fs.statSync(workDir).isDirectory()) return `workingDir ${workDir} is not a directory.`;
		return null;
	} catch (error) {
		return isEnoent(error) ? `workingDir ${workDir} does not exist.` : `workingDir ${workDir} is unavailable.`;
	}
}

function parsePendingRunSummary(
	value: unknown,
	runDirectory: string,
	directoryName: string,
	loggedRunNumbers: ReadonlySet<number>,
): PendingRunSummary | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as {
		abandonedAt?: unknown;
		checks?: { durationSeconds?: unknown; passed?: unknown; timedOut?: unknown };
		completedAt?: unknown;
		command?: unknown;
		durationSeconds?: unknown;
		exitCode?: unknown;
		loggedAt?: unknown;
		parsedAsi?: unknown;
		parsedMetrics?: unknown;
		parsedPrimary?: unknown;
		preRunDirtyPaths?: unknown;
		runNumber?: unknown;
		status?: unknown;
		timedOut?: unknown;
	};
	if (candidate.loggedAt !== undefined || candidate.status !== undefined) return null;
	if (typeof candidate.abandonedAt === "string" && candidate.abandonedAt.trim().length > 0) return null;

	const command = typeof candidate.command === "string" ? candidate.command : "";
	const runNumber = finiteOrNull(candidate.runNumber) ?? parseInt(directoryName, 10);
	if (!Number.isFinite(runNumber)) return null;
	if (loggedRunNumbers.has(runNumber)) return null;

	const completionKeys = [
		"completedAt",
		"exitCode",
		"timedOut",
		"durationSeconds",
		"checks",
		"parsedPrimary",
		"parsedMetrics",
		"parsedAsi",
	] as const;
	if (!completionKeys.some(k => candidate[k] !== undefined)) return null;

	const checksPass =
		typeof candidate.checks?.passed === "boolean"
			? candidate.checks.passed
			: typeof candidate.checks?.timedOut === "boolean" && candidate.checks.timedOut
				? false
				: null;
	const exitCode = finiteOrNull(candidate.exitCode);
	const timedOut = candidate.timedOut === true;
	const durationSeconds = finiteOrNull(candidate.durationSeconds);
	const parsedPrimary = finiteOrNull(candidate.parsedPrimary);
	const parsedAsi = cloneAsiData(candidate.parsedAsi);
	const parsedMetrics = cloneNumericMetricMap(candidate.parsedMetrics);
	const checksDurationSeconds = finiteOrNull(candidate.checks?.durationSeconds);
	const checksTimedOut = candidate.checks?.timedOut === true;

	const preRunDirtyPaths = Array.isArray(candidate.preRunDirtyPaths)
		? candidate.preRunDirtyPaths.filter((item): item is string => typeof item === "string")
		: [];

	return {
		checksDurationSeconds,
		checksPass,
		checksTimedOut,
		command,
		durationSeconds,
		parsedAsi,
		parsedMetrics,
		parsedPrimary,
		passed: exitCode === 0 && !timedOut && checksPass !== false,
		preRunDirtyPaths,
		runDirectory,
		runNumber,
	};
}

function cloneNumericMetricMap(value: unknown): NumericMetricMap | null {
	if (typeof value !== "object" || value === null) return null;
	const clone: NumericMetricMap = {};
	for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
		if (DENIED_KEY_NAMES.has(key)) continue;
		const num = finiteOrNull(entryValue);
		if (num !== null) clone[key] = num;
	}
	return Object.keys(clone).length > 0 ? clone : null;
}

function cloneAsiData(value: unknown): ASIData | null {
	if (typeof value !== "object" || value === null) return null;
	const result = clonePendingAsiValue(value) as ASIData | undefined;
	return result && Object.keys(result).length > 0 ? result : null;
}

function clonePendingAsiValue(value: unknown): ASIValue | undefined {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return value;
	if (Array.isArray(value))
		return value.map(e => clonePendingAsiValue(e)).filter((e): e is NonNullable<typeof e> => e !== undefined);
	if (typeof value !== "object") return undefined;
	const clone: { [key: string]: ASIValue } = {};
	for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
		if (DENIED_KEY_NAMES.has(key)) continue;
		const sanitized = clonePendingAsiValue(v);
		if (sanitized !== undefined) clone[key] = sanitized;
	}
	return clone;
}
