import * as fs from "node:fs";
import * as path from "node:path";
import { inferMetricUnitFromName, normalizeAutoresearchPath } from "./helpers";
import type { AutoresearchContract, ExperimentState, MetricDirection } from "./types";

const HEADING_REGEX = /^##\s+(.+?)\s*$/;
const LIST_ITEM_REGEX = /^\s*[-*]\s+(.*)$/;
const KEY_VALUE_REGEX = /^\s*[-*]\s+([^:]+):\s*(.*)$/;
function tryReadFile(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}
export function readAutoresearchContract(workDir: string) {
	const contractPath = path.join(workDir, "autoresearch.md");
	const content = tryReadFile(contractPath);
	if (content === null)
		return {
			contract: {
				benchmark: { command: null, primaryMetric: null, metricUnit: "", direction: null, secondaryMetrics: [] },
				scopePaths: [],
				offLimits: [],
				constraints: [],
			},
			errors: [`${contractPath} does not exist. Create it before initializing autoresearch.`],
			path: contractPath,
		};
	const contract = parseAutoresearchContract(content);
	return { contract, errors: validateAutoresearchContract(contract), path: contractPath };
}
export function parseAutoresearchContract(markdown: string): AutoresearchContract {
	const sections = extractSections(markdown);
	return {
		benchmark: parseBenchmarkSection(sections.get("benchmark") ?? ""),
		scopePaths: parseListSection(sections.get("files in scope") ?? "", normalizeContractPathSpec),
		offLimits: parseListSection(sections.get("off limits") ?? "", normalizeContractPathSpec),
		constraints: parseListSection(sections.get("constraints") ?? ""),
	};
}
function validateAutoresearchContract(contract: AutoresearchContract): string[] {
	const errors: string[] = [];
	if (!contract.benchmark.command) errors.push("Benchmark.command is required in autoresearch.md.");
	if (!contract.benchmark.primaryMetric) errors.push("Benchmark.primary metric is required in autoresearch.md.");
	if (!contract.benchmark.direction)
		errors.push("Benchmark.direction must be `lower` or `higher` in autoresearch.md.");
	if (contract.scopePaths.length === 0)
		errors.push("Files in Scope must contain at least one path in autoresearch.md.");
	for (const [label, paths] of [
		["Files in Scope", contract.scopePaths],
		["Off Limits", contract.offLimits],
	] as const)
		for (const p of paths)
			if (path.posix.isAbsolute(p) || p === ".." || p.startsWith("../"))
				errors.push(`${label} contains an invalid path: ${p}`);
	return errors;
}
export function loadAutoresearchScriptSnapshot(workDir: string) {
	const benchmarkScriptPath = path.join(workDir, "autoresearch.sh");
	const checksScriptPath = path.join(workDir, "autoresearch.checks.sh");
	const benchmarkScript = tryReadFile(benchmarkScriptPath);
	return {
		benchmarkScript: benchmarkScript ?? "",
		benchmarkScriptPath,
		checksScript: tryReadFile(checksScriptPath),
		checksScriptPath,
		errors:
			benchmarkScript === null
				? [`${benchmarkScriptPath} does not exist. Create it before initializing autoresearch.`]
				: [],
	};
}
export function normalizeAutoresearchList(values: readonly string[]): string[] {
	return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}
export function normalizeContractPathSpec(value: string): string {
	return normalizeAutoresearchPath(path.posix.normalize(value.trim().replaceAll("\\", "/")));
}
export function pathMatchesContractPath(pathValue: string, specValue: string): boolean {
	const normalizedPath = normalizeContractPathSpec(pathValue);
	const normalizedSpec = normalizeContractPathSpec(specValue);
	if (normalizedSpec === ".") return true;
	return normalizedPath === normalizedSpec || normalizedPath.startsWith(`${normalizedSpec}/`);
}
export function contractListsEqual(left: readonly string[], right: readonly string[]): boolean {
	const a = normalizeAutoresearchList(left);
	const b = normalizeAutoresearchList(right);
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
export function contractPathListsEqual(left: readonly string[], right: readonly string[]): boolean {
	const norm = (values: readonly string[]) =>
		normalizeAutoresearchList(values.map(normalizeContractPathSpec)).sort((l, r) => l.localeCompare(r));
	const a = norm(left);
	const b = norm(right);
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
function extractSections(markdown: string): Map<string, string> {
	const sections = new Map<string, string>();
	let heading: string | null = null;
	let content: string[] = [];
	for (const line of markdown.split("\n")) {
		const match = line.match(HEADING_REGEX);
		if (match) {
			if (heading) sections.set(heading, content.join("\n").trim());
			heading = match[1]?.trim().toLowerCase() ?? null;
			content = [];
		} else if (heading) {
			content.push(line);
		}
	}
	if (heading) sections.set(heading, content.join("\n").trim());
	return sections;
}
function parseBenchmarkSection(section: string): AutoresearchContract["benchmark"] {
	const entries = new Map<string, string>();
	const lines = section.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const rawLine = lines[index] ?? "";
		const match = rawLine.match(KEY_VALUE_REGEX);
		if (!match) continue;
		const key = (match[1] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
		let value = (match[2] ?? "").trim();
		if (key === "secondarymetrics") {
			const nestedItems: string[] = [];
			for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
				const nestedLine = lines[nestedIndex] ?? "";
				if (nestedLine.match(KEY_VALUE_REGEX)) break;
				const nestedMatch = nestedLine.match(/^\s{2,}[-*]\s+(.*)$/);
				if (!nestedMatch && nestedLine.trim().length > 0) break;
				if (!nestedMatch) continue;
				nestedItems.push((nestedMatch[1] ?? "").trim());
				index = nestedIndex;
			}
			if (nestedItems.length > 0) value = [value, ...nestedItems].filter(Boolean).join(", ");
		}
		entries.set(key, value);
	}

	const directionRaw = entries.get("direction");
	const direction: MetricDirection | null =
		directionRaw === "lower" || directionRaw === "higher" ? directionRaw : null;
	return {
		command: entries.get("command")?.trim() || null,
		primaryMetric: entries.get("primarymetric")?.trim() || null,
		metricUnit: entries.get("metricunit")?.trim() ?? "",
		direction,
		secondaryMetrics: entries.get("secondarymetrics")
			? normalizeAutoresearchList(
					entries
						.get("secondarymetrics")!
						.split(",")
						.map(e => e.trim())
						.filter(Boolean),
				)
			: [],
	};
}
function parseListSection(section: string, normalizeItem?: (value: string) => string): string[] {
	const items: string[] = [];
	let activeItem: string | null = null;
	for (const rawLine of section.split("\n")) {
		const line = rawLine.trimEnd();
		if (line.trim().length === 0) continue;
		const match = rawLine.match(LIST_ITEM_REGEX);
		if (match) {
			if (activeItem) items.push(activeItem);
			activeItem = (match[1] ?? "").trim();
			continue;
		}
		if (activeItem && /^\s{2,}\S/.test(rawLine)) {
			activeItem = `${activeItem} ${line.trim()}`;
			continue;
		}
		if (activeItem) {
			items.push(activeItem);
			activeItem = null;
		}
		items.push(line.trim());
	}
	if (activeItem) items.push(activeItem);
	const normalizedItems = normalizeAutoresearchList(items);
	return normalizeItem ? normalizedItems.map(normalizeItem) : normalizedItems;
}
/**
 * Updates session fields from a validated `autoresearch.md` parse (same fields as `init_experiment`).
 * Does not touch `name`, `currentSegment`, `results`, `bestMetric`, `confidence`, or `maxExperiments`.
 */
export function applyAutoresearchContractToExperimentState(
	contract: AutoresearchContract,
	state: ExperimentState,
): void {
	const benchmarkContract = contract.benchmark;
	state.metricName = benchmarkContract.primaryMetric ?? state.metricName;
	state.metricUnit = benchmarkContract.metricUnit;
	state.bestDirection = benchmarkContract.direction ?? "lower";
	state.secondaryMetrics = benchmarkContract.secondaryMetrics.map(name => ({
		name,
		unit: inferMetricUnitFromName(name),
	}));
	state.benchmarkCommand = benchmarkContract.command?.trim() ?? state.benchmarkCommand;
	state.scopePaths = [...contract.scopePaths];
	state.offLimits = [...contract.offLimits];
	state.constraints = [...contract.constraints];
}
