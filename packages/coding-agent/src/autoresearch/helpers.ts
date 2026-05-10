import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent } from "@f5xc-salesdemos/pi-utils";
import { parseCommandArgs } from "../utils/command-args";
import type { ASIData, ASIValue, MetricDirection, NumericMetricMap, PendingRunSummary } from "./types";

export const EXPERIMENT_MAX_LINES = 10;
export const EXPERIMENT_MAX_BYTES = 4 * 1024;
const AUTORESEARCH_COMMITTABLE_FILES = new Set(
	"autoresearch.md autoresearch.sh autoresearch.checks.sh autoresearch.ideas.md".split(" "),
);
export const DENIED_KEY_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const COMPLETION_KEYS =
	"completedAt exitCode timedOut durationSeconds checks parsedPrimary parsedMetrics parsedAsi".split(" ");
export const finiteOrNull = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
export function parseMetricLines(output: string): Map<string, number> {
	return new Map(
		[...output.matchAll(/^METRIC\s+([\w.µ-]+)=(\S+)\s*$/gm)]
			.filter(([, name]) => name && !DENIED_KEY_NAMES.has(name))
			.map(([, name, raw]) => [name, Number(raw)] as const)
			.filter(([, v]) => Number.isFinite(v)),
	);
}
export function parseAsiLines(output: string): ASIData | null {
	const asi: ASIData = {};
	for (const [, key, raw] of output.matchAll(/^ASI\s+([\w.-]+)=(.+)\s*$/gm))
		if (key && !DENIED_KEY_NAMES.has(key)) asi[key] = parseAsiValue(raw);
	return Object.keys(asi).length > 0 ? asi : null;
}
function parseAsiValue(raw: string): ASIValue {
	const value = raw.trim();
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	const n = /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
	if (Number.isFinite(n)) return n;
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
	return { ...(base ?? {}), ...(override ?? {}) };
}
const COMMA_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const commas = (value: number): string => COMMA_FORMAT.format(Math.trunc(value));
export function formatNum(value: number | null, unit: string): string {
	if (value === null) return "-";
	if (Number.isInteger(value)) return `${commas(Math.round(value))}${unit}`;
	const absolute = Math.abs(value);
	const whole = Math.floor(absolute);
	return `${value < 0 ? "-" : ""}${commas(whole)}${(absolute - whole).toFixed(2).slice(1)}${unit}`;
}
export function formatElapsed(milliseconds: number): string {
	const s = Math.floor(milliseconds / 1000);
	return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
export const getAutoresearchRunDirectory = (workDir: string, runNumber: number): string =>
	path.join(workDir, ".autoresearch", "runs", String(runNumber).padStart(4, "0"));
export function getNextAutoresearchRunNumber(workDir: string, lastRunNumber: number | null): number {
	const runsDir = path.join(workDir, ".autoresearch", "runs");
	try {
		const nums = fs
			.readdirSync(runsDir, { withFileTypes: true })
			.filter(e => e.isDirectory())
			.map(e => Number.parseInt(e.name, 10))
			.filter(Number.isFinite);
		return Math.max(lastRunNumber ?? 0, ...nums) + 1;
	} catch (error) {
		if (!isEnoent(error)) throw error;
		return (lastRunNumber ?? 0) + 1;
	}
}
export const normalizeAutoresearchPath = (relativePath: string): string =>
	(n => (n === "." || n === "./" ? "." : n.replace(/^\.\/+/, "").replace(/\/+$/, "")))(
		relativePath.replaceAll("\\", "/").trim(),
	);
export const isAutoresearchCommittableFile = (relativePath: string): boolean =>
	AUTORESEARCH_COMMITTABLE_FILES.has(normalizeAutoresearchPath(relativePath));
export function isAutoresearchLocalStatePath(relativePath: string): boolean {
	const normalized = normalizeAutoresearchPath(relativePath);
	return (
		normalized === "autoresearch.jsonl" || normalized === ".autoresearch" || normalized.startsWith(".autoresearch/")
	);
}
export function killTree(pid: number, signal: NodeJS.Signals | number = "SIGTERM"): void {
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, signal);
			return;
		} catch {}
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
export const isBetter = (current: number, best: number, direction: MetricDirection): boolean =>
	direction === "lower" ? current < best : current > best;
export const inferMetricUnitFromName = (name: string): string =>
	(m => (m ? (m[1] ?? "s") : ""))(name.match(/(?:_?(µs|ms|mb|kb)|_(s|sec|secs))$/));
export async function readPendingRunSummary(
	workDir: string,
	loggedRunNumbers: ReadonlySet<number> = new Set<number>(),
): Promise<PendingRunSummary | null> {
	const entries = await readRunDirectoryEntries(workDir);
	if (!entries) return null;
	for (const entry of entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
		const { parsed, runDirectory } = await readRunArtifact(workDir, entry.name);
		if (!parsed) continue;
		const pendingRun = parsePendingRunSummary(parsed, runDirectory, entry.name, loggedRunNumbers);
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
		const { parsed, runDirectory, runJsonPath } = await readRunArtifact(workDir, entry.name);
		if (!parsed) continue;
		if (!parsePendingRunSummary(parsed, runDirectory, entry.name, loggedRunNumbers)) continue;
		await Bun.write(
			runJsonPath,
			JSON.stringify({ ...(parsed as Record<string, unknown>), abandonedAt: stamp }, null, 2),
		);
		abandoned += 1;
	}
	return abandoned;
}
async function readRunDirectoryEntries(workDir: string): Promise<fs.Dirent[] | null> {
	try {
		return await fs.promises.readdir(path.join(workDir, ".autoresearch", "runs"), { withFileTypes: true });
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
	try {
		const o = JSON.parse(fs.readFileSync(path.join(cwd, "autoresearch.config.json"), "utf8")) as unknown;
		if (typeof o !== "object" || o === null) return {};
		const c = o as { maxIterations?: unknown; workingDir?: unknown };
		const maxIter = finiteOrNull(c.maxIterations);
		const wd = typeof c.workingDir === "string" && c.workingDir.trim().length > 0 ? c.workingDir : undefined;
		return { ...(maxIter !== null && { maxIterations: maxIter }), ...(wd && { workingDir: wd }) };
	} catch {
		return {};
	}
}
export const readMaxExperiments = (cwd: string): number | null =>
	(v => (v !== undefined && v > 0 ? Math.floor(v) : null))(readConfig(cwd).maxIterations);
export const resolveWorkDir = (cwd: string): string =>
	(c => (c ? (path.isAbsolute(c) ? c : path.resolve(cwd, c)) : cwd))(readConfig(cwd).workingDir);
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
	const candidate = value as Record<string, unknown>;
	const checks = candidate.checks as Record<string, unknown> | undefined;
	if (candidate.loggedAt !== undefined || candidate.status !== undefined) return null;
	if (typeof candidate.abandonedAt === "string" && candidate.abandonedAt.trim().length > 0) return null;
	const runNumber = finiteOrNull(candidate.runNumber) ?? parseInt(directoryName, 10);
	if (!Number.isFinite(runNumber) || loggedRunNumbers.has(runNumber)) return null;
	if (!COMPLETION_KEYS.some(k => candidate[k] !== undefined)) return null;
	const checksPass =
		typeof checks?.passed === "boolean"
			? checks.passed
			: typeof checks?.timedOut === "boolean" && checks.timedOut
				? false
				: null;
	return {
		checksDurationSeconds: finiteOrNull(checks?.durationSeconds),
		checksPass,
		checksTimedOut: checks?.timedOut === true,
		command: typeof candidate.command === "string" ? candidate.command : "",
		durationSeconds: finiteOrNull(candidate.durationSeconds),
		parsedAsi: cloneAsiData(candidate.parsedAsi),
		parsedMetrics: cloneNumericMetricMap(candidate.parsedMetrics),
		parsedPrimary: finiteOrNull(candidate.parsedPrimary),
		passed: finiteOrNull(candidate.exitCode) === 0 && candidate.timedOut !== true && checksPass !== false,
		preRunDirtyPaths: Array.isArray(candidate.preRunDirtyPaths)
			? candidate.preRunDirtyPaths.filter((item): item is string => typeof item === "string")
			: [],
		runDirectory,
		runNumber,
	};
}
export function cloneNumericMetricMap(value: unknown): NumericMetricMap | null {
	if (typeof value !== "object" || value === null) return null;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([key]) => !DENIED_KEY_NAMES.has(key))
		.map(([key, v]) => [key, finiteOrNull(v)] as const)
		.filter((e): e is [string, number] => e[1] !== null);
	return entries.length > 0 ? (Object.fromEntries(entries) as NumericMetricMap) : null;
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
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([key]) => !DENIED_KEY_NAMES.has(key))
			.map(([key, v]) => [key, clonePendingAsiValue(v)] as const)
			.filter((e): e is [string, ASIValue] => e[1] !== undefined),
	) as { [key: string]: ASIValue };
}
