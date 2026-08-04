/** Reproducible quality, reliability, and performance analysis for a live scenario report. */
import * as path from "node:path";
import type { Effort } from "@f5-sales-demo/pi-ai";
import type { ModelBenchmarkTarget } from "./model-matrix-report";
import type {
	ScenarioBenchmarkReport,
	ScenarioBenchmarkSample,
} from "./model-scenario-report";

export interface BenchmarkDistribution {
	samples: number;
	min: number;
	mean: number;
	p50: number;
	p95: number;
	max: number;
	standardDeviation: number;
	coefficientOfVariation: number;
}

export interface ScenarioAnalysisRow {
	scenarioId: string;
	scenarioLabel: string;
	suite: string;
	tier: number;
	thinking: Effort;
	effectiveThinking: Effort[];
	label: string;
	selector: string;
	samples: number;
	successRate: number;
	contractPassRate: number;
	quality: BenchmarkDistribution | null;
	visibleWords: BenchmarkDistribution | null;
	ttftMs: BenchmarkDistribution | null;
	timeToFirstToolMs: BenchmarkDistribution | null;
	responseMs: BenchmarkDistribution | null;
	toolExecutionMs: BenchmarkDistribution | null;
	processMs: BenchmarkDistribution | null;
	outputTokensPerSecond: BenchmarkDistribution | null;
	outputTokens: BenchmarkDistribution | null;
	observedCostTotal: number;
	failedQualityCriteria: Array<{ id: string; label: string; failures: number }>;
	representativeResponse: {
		round: number;
		qualityScore: number;
		visibleWords: number;
		response: string;
	};
}

export interface ModelAnalysisRow {
	rank: number | null;
	qualityRank: number | null;
	speedRank: number | null;
	availability: "available" | "unavailable";
	label: string;
	selector: string;
	thinking: Effort;
	effectiveThinking: Effort[];
	samples: number;
	successRate: number;
	contractPassRate: number;
	qualityScore: number;
	reliabilityScore: number;
	speedScore: number;
	balancedScore: number;
	ttftWins: number;
	responseWins: number;
	ttftMs: BenchmarkDistribution | null;
	responseMs: BenchmarkDistribution | null;
	timeToFirstToolMs: BenchmarkDistribution | null;
	outputTokensPerSecond: BenchmarkDistribution | null;
	visibleWords: BenchmarkDistribution | null;
	observedCostTotal: number;
}

export interface ScenarioBenchmarkAnalysis {
	schemaVersion: 2;
	createdAt: string;
	sourceReportCreatedAt: string;
	methodology: {
		quality: string;
		reliability: string;
		speed: string;
		balanced: string;
		variability: string;
		cost: string;
	};
	models: ModelAnalysisRow[];
	scenarios: ScenarioAnalysisRow[];
}

interface CliOptions {
	inputFile: string;
	jsonFile: string;
	markdownFile: string;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: number[], proportion: number): number {
	return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(proportion * sorted.length) - 1))];
}

function distribution(values: Array<number | undefined>): BenchmarkDistribution | null {
	const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (present.length === 0) return null;
	const sorted = [...present].sort((left, right) => left - right);
	const average = mean(sorted);
	const variance = mean(sorted.map(value => (value - average) ** 2));
	const standardDeviation = Math.sqrt(variance);
	const middle = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	return {
		samples: sorted.length,
		min: round(sorted[0]),
		mean: round(average),
		p50: round(median),
		p95: round(percentile(sorted, 0.95)),
		max: round(sorted.at(-1) ?? sorted[0]),
		standardDeviation: round(standardDeviation),
		coefficientOfVariation: average === 0 ? 0 : round(standardDeviation / average),
	};
}

function rate(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : round(numerator / denominator);
}

function selectRepresentative(samples: ScenarioBenchmarkSample[]): ScenarioBenchmarkSample {
	const ranked = [...samples].sort((left, right) => {
		if (left.quality.score !== right.quality.score) return right.quality.score - left.quality.score;
		if (left.quality.visibleWords !== right.quality.visibleWords) {
			return left.quality.visibleWords - right.quality.visibleWords;
		}
		return left.round - right.round;
	});
	const selected = ranked[0];
	if (!selected) throw new Error("Cannot select a representative from an empty sample set");
	return selected;
}

function analyzeScenarioRow(
	scenario: ScenarioBenchmarkReport["config"]["scenarios"][number],
	target: ModelBenchmarkTarget,
	thinking: Effort,
	samples: ScenarioBenchmarkSample[],
): ScenarioAnalysisRow {
	const selected = samples.filter(
		sample =>
			sample.scenarioId === scenario.id &&
			sample.selector === target.selector &&
			sample.requestedThinking === thinking,
	);
	const successful = selected.filter(sample => sample.success);
	const representative = selectRepresentative(selected);
	const criterionFailures = new Map<string, { id: string; label: string; failures: number }>();
	for (const sample of selected) {
		for (const criterion of sample.quality.criteria) {
			if (criterion.passed) continue;
			const current = criterionFailures.get(criterion.id);
			criterionFailures.set(criterion.id, {
				id: criterion.id,
				label: criterion.label,
				failures: (current?.failures ?? 0) + 1,
			});
		}
	}
	return {
		scenarioId: scenario.id,
		scenarioLabel: scenario.label,
		suite: scenario.suite,
		tier: scenario.tier,
		thinking,
		effectiveThinking: [...new Set(selected.flatMap(sample => sample.effectiveThinking ?? []))],
		label: target.label,
		selector: target.selector,
		samples: selected.length,
		successRate: rate(successful.length, selected.length),
		contractPassRate: rate(selected.filter(sample => sample.contractPassed).length, selected.length),
		quality: distribution(selected.map(sample => sample.quality.score)),
		visibleWords: distribution(selected.map(sample => sample.quality.visibleWords)),
		ttftMs: distribution(successful.map(sample => sample.ttftMs)),
		timeToFirstToolMs: distribution(successful.map(sample => sample.timeToFirstToolMs)),
		responseMs: distribution(successful.map(sample => sample.responseDurationMs)),
		toolExecutionMs: distribution(successful.map(sample => sample.totalToolDurationMs)),
		processMs: distribution(successful.map(sample => sample.processDurationMs)),
		outputTokensPerSecond: distribution(successful.map(sample => sample.outputTokensPerSecond)),
		outputTokens: distribution(successful.map(sample => sample.usage?.output)),
		observedCostTotal: round(successful.reduce((sum, sample) => sum + (sample.usage?.costTotal ?? 0), 0)),
		failedQualityCriteria: [...criterionFailures.values()].sort((left, right) =>
			left.id.localeCompare(right.id),
		),
		representativeResponse: {
			round: representative.round,
			qualityScore: representative.quality.score,
			visibleWords: representative.quality.visibleWords,
			response: representative.response,
		},
	};
}

function scenarioSpeedScores(
	target: ModelBenchmarkTarget,
	scenarioRows: ScenarioAnalysisRow[],
): { score: number; ttftWins: number; responseWins: number } {
	const targetRows = scenarioRows.filter(row => row.selector === target.selector);
	const ratios: number[] = [];
	let ttftWins = 0;
	let responseWins = 0;
	for (const row of targetRows) {
		const peers = scenarioRows.filter(
			candidate => candidate.scenarioId === row.scenarioId && candidate.thinking === row.thinking,
		);
		const ttfts = peers.map(peer => peer.ttftMs?.p50).filter((value): value is number => value !== undefined);
		const responses = peers
			.map(peer => peer.responseMs?.p50)
			.filter((value): value is number => value !== undefined);
		const fastestTtft = ttfts.length > 0 ? Math.min(...ttfts) : undefined;
		const fastestResponse = responses.length > 0 ? Math.min(...responses) : undefined;
		if (fastestTtft !== undefined && row.ttftMs) {
			ratios.push((fastestTtft / row.ttftMs.p50) * 100);
			if (row.ttftMs.p50 === fastestTtft) ttftWins++;
		} else {
			ratios.push(0);
		}
		if (fastestResponse !== undefined && row.responseMs) {
			ratios.push((fastestResponse / row.responseMs.p50) * 100);
			if (row.responseMs.p50 === fastestResponse) responseWins++;
		} else {
			ratios.push(0);
		}
	}
	return { score: round(mean(ratios)), ttftWins, responseWins };
}

function rankBy(rows: ModelAnalysisRow[], metric: (row: ModelAnalysisRow) => number): Map<string, number> {
	const ordered = rows
		.filter(row => row.availability === "available")
		.sort((left, right) => metric(right) - metric(left) || left.label.localeCompare(right.label));
	return new Map(ordered.map((row, index) => [row.selector, index + 1]));
}

export function analyzeScenarioBenchmarkReport(report: ScenarioBenchmarkReport): ScenarioBenchmarkAnalysis {
	if (report.schemaVersion !== 3) throw new Error(`Unsupported scenario report schema: ${report.schemaVersion}`);
	const scenarioRows = report.config.scenarios.flatMap(scenario =>
		report.config.thinkingEfforts.flatMap(thinking =>
			report.config.models.map(target => analyzeScenarioRow(scenario, target, thinking, report.samples)),
		),
	);
	const unranked: ModelAnalysisRow[] = report.config.thinkingEfforts.flatMap(thinking => report.config.models.map(target => {
		const samples = report.samples.filter(
			sample => sample.selector === target.selector && sample.requestedThinking === thinking,
		);
		const successful = samples.filter(sample => sample.success);
		const qualityScore = mean(samples.map(sample => sample.quality.score));
		const successRate = rate(successful.length, samples.length);
		const contractPassRate = rate(samples.filter(sample => sample.contractPassed).length, samples.length);
		const reliabilityScore = ((successRate + contractPassRate) / 2) * 100;
		const speed = scenarioSpeedScores(target, scenarioRows.filter(row => row.thinking === thinking));
		return {
			rank: null,
			qualityRank: null,
			speedRank: null,
			availability: successful.length > 0 ? "available" : "unavailable",
			label: target.label,
			selector: target.selector,
			thinking,
			effectiveThinking: [...new Set(samples.flatMap(sample => sample.effectiveThinking ?? []))],
			samples: samples.length,
			successRate,
			contractPassRate,
			qualityScore: round(qualityScore),
			reliabilityScore: round(reliabilityScore),
			speedScore: speed.score,
			balancedScore: round(qualityScore * 0.6 + reliabilityScore * 0.2 + speed.score * 0.2),
			ttftWins: speed.ttftWins,
			responseWins: speed.responseWins,
			ttftMs: distribution(successful.map(sample => sample.ttftMs)),
			responseMs: distribution(successful.map(sample => sample.responseDurationMs)),
			timeToFirstToolMs: distribution(successful.map(sample => sample.timeToFirstToolMs)),
			outputTokensPerSecond: distribution(successful.map(sample => sample.outputTokensPerSecond)),
			visibleWords: distribution(samples.map(sample => sample.quality.visibleWords)),
			observedCostTotal: round(successful.reduce((sum, sample) => sum + (sample.usage?.costTotal ?? 0), 0)),
		};
	}));
	const models = report.config.thinkingEfforts.flatMap(thinking => {
		const rows = unranked.filter(row => row.thinking === thinking);
		const balancedRanks = rankBy(rows, row => row.balancedScore);
		const qualityRanks = rankBy(rows, row => row.qualityScore);
		const speedRanks = rankBy(rows, row => row.speedScore);
		return rows
			.map(row => ({
				...row,
				rank: balancedRanks.get(row.selector) ?? null,
				qualityRank: qualityRanks.get(row.selector) ?? null,
				speedRank: speedRanks.get(row.selector) ?? null,
			}))
			.sort((left, right) => {
				if (left.rank === null) return right.rank === null ? left.label.localeCompare(right.label) : 1;
				if (right.rank === null) return -1;
				return left.rank - right.rank;
			});
	});
	return {
		schemaVersion: 2,
		createdAt: new Date().toISOString(),
		sourceReportCreatedAt: report.createdAt,
		methodology: {
			quality: "Mean deterministic rubric score across all measured responses; every criterion and failure is retained.",
			reliability: "Equal-weight mean of transport success rate and scenario contract pass rate.",
			speed: "Mean of per-scenario relative TTFT and end-to-end scores, where the fastest model is 100 and peers receive fastest/observed × 100.",
			balanced: "60% output quality + 20% reliability + 20% speed. Throughput and cost are reported but are not folded into this score.",
			variability: "Population standard deviation and coefficient of variation over successful measured samples; p95 uses nearest rank.",
			cost: "Observed provider-reported cost only. Zero can mean unavailable pricing rather than free execution.",
		},
		models,
		scenarios: scenarioRows,
	};
}

function formatNumber(value: number | undefined, digits = 1): string {
	return value === undefined ? "—" : value.toFixed(digits);
}

function formatRate(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number): string {
	return value === 0 ? "0/unreported" : `$${value.toFixed(6)}`;
}

function formatRank(value: number | null): string {
	return value === null ? "unavailable" : String(value);
}

function escapeCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function fencedText(value: string): string {
	const longestBacktickRun = Math.max(2, ...[...value.matchAll(/`+/g)].map(match => match[0].length));
	const fence = "`".repeat(longestBacktickRun + 1);
	return `${fence}text\n${value}\n${fence}`;
}

function table(headers: string[], rows: string[][]): string {
	return [
		`| ${headers.join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...rows.map(row => `| ${row.map(escapeCell).join(" | ")} |`),
	].join("\n");
}

export function renderScenarioBenchmarkAnalysis(
	analysis: ScenarioBenchmarkAnalysis,
	report: ScenarioBenchmarkReport,
): string {
	const ranking = table(
		["Effort requested→effective", "Rank", "Model", "Balanced", "Quality rank/score", "Speed rank/score", "Reliability", "TTFT p50", "End-to-end p50", "TTFT wins"],
		analysis.models.map(model => [
			`${model.thinking}→${model.effectiveThinking.join(", ") || "unverified"}`,
			formatRank(model.rank),
			model.label,
			model.availability === "available" ? formatNumber(model.balancedScore) : "unavailable",
			model.availability === "available"
				? `${formatRank(model.qualityRank)} / ${formatNumber(model.qualityScore)}`
				: "unavailable",
			model.availability === "available"
				? `${formatRank(model.speedRank)} / ${formatNumber(model.speedScore)}`
				: "unavailable",
			formatNumber(model.reliabilityScore),
			`${formatNumber(model.ttftMs?.p50)} ms`,
			`${formatNumber(model.responseMs?.p50)} ms`,
			`${model.ttftWins}/${report.config.scenarios.length}`,
		]),
	);
	const performance = table(
		["Scenario", "Effort requested→effective", "Model", "Contract", "Quality", "TTFT p50/p95", "TTFT CV", "First tool p50", "End-to-end p50/p95", "Output tokens/s", "Words p50", "Cost"],
		analysis.scenarios.map(row => [
			row.scenarioId,
			`${row.thinking}→${row.effectiveThinking.join(", ") || "unverified"}`,
			row.label,
			formatRate(row.contractPassRate),
			formatNumber(row.quality?.mean),
			`${formatNumber(row.ttftMs?.p50)}/${formatNumber(row.ttftMs?.p95)} ms`,
			formatNumber(row.ttftMs?.coefficientOfVariation, 3),
			`${formatNumber(row.timeToFirstToolMs?.p50)} ms`,
			`${formatNumber(row.responseMs?.p50)}/${formatNumber(row.responseMs?.p95)} ms`,
			formatNumber(row.outputTokensPerSecond?.p50),
			formatNumber(row.visibleWords?.p50),
			formatCost(row.observedCostTotal),
		]),
	);
	const qualityRows = analysis.scenarios
		.filter(row => row.suite === "identity")
		.map(row => [
			row.scenarioId,
			row.thinking,
			row.label,
			`${formatNumber(row.quality?.mean)} (${formatNumber(row.quality?.min)}–${formatNumber(row.quality?.max)})`,
			formatNumber(row.visibleWords?.p50),
			row.failedQualityCriteria.length === 0
				? "None"
				: row.failedQualityCriteria.map(failure => `${failure.label} (${failure.failures}/${row.samples})`).join("; "),
		]);
	const quality = table(["Scenario", "Effort", "Model", "Quality mean (range)", "Words p50", "Failed criteria"], qualityRows);
	const openEndedScenarioIds = new Set(
		report.config.scenarios.filter(scenario => scenario.suite === "identity").map(scenario => scenario.id),
	);
	const responses = analysis.scenarios
		.filter(row => openEndedScenarioIds.has(row.scenarioId))
		.map(
			row =>
				`### ${row.scenarioLabel} — ${row.label} — ${row.thinking}\n\nRepresentative measured response: round ${row.representativeResponse.round}, quality ${row.representativeResponse.qualityScore.toFixed(1)}, ${row.representativeResponse.visibleWords} visible words. Ties select the shortest response.\n\n${fencedText(row.representativeResponse.response)}`,
		)
		.join("\n\n");
	const effortLeaders = report.config.thinkingEfforts.map(thinking => {
		const rows = analysis.models.filter(model => model.thinking === thinking);
		const topBalanced = rows.find(model => model.rank === 1);
		const topQuality = rows.find(model => model.qualityRank === 1);
		const topSpeed = rows.find(model => model.speedRank === 1);
		return `${thinking}: balanced ${topBalanced?.label ?? "none"}; quality ${topQuality?.label ?? "none"}; speed ${topSpeed?.label ?? "none"}`;
	}).join("\n");
	const variabilityNote =
		report.config.runs < 3
			? `${report.config.runs} measured ${report.config.runs === 1 ? "run" : "runs"} per cell is exploratory: p50 and p95 are the same observation, and cross-run variability cannot be estimated.`
			: `${report.config.runs} measured runs per cell expose gross jitter but are not enough for a stable tail-latency estimate.`;
	return `<!-- markdownlint-configure-file { "MD013": false } -->

# xcsh three-model benchmark analysis

Source run: ${analysis.sourceReportCreatedAt}
Analysis generated: ${analysis.createdAt}
Matrix: ${report.config.models.length} models × ${report.config.thinkingEfforts.length} efforts × ${report.config.scenarios.length} scenarios × ${report.config.runs} measured ${report.config.runs === 1 ? "run" : "runs"}, after ${report.config.warmups} warm-up run(s)
Reasoning efforts: ${report.config.thinkingEfforts.join(", ")}; order: ${report.config.order}; context: ${report.config.contextName ?? "none"}

## Results

${effortLeaders}

${ranking}

The balanced score is a decision aid, not a universal model ranking: 60% rubric-scored output quality, 20% reliability, and 20% relative speed. Quality and speed ranks remain separate so the weighting cannot hide their trade-off.

## Per-scenario performance and quality matrix

${performance}

TTFT is measured from xcsh's user-message event to its first non-empty text delta. On tool scenarios this is final-answer TTFT; "First tool p50" isolates model time to the first requested action. End-to-end runs from the user-message event through the last assistant completion. CV is standard deviation divided by mean. ${variabilityNote}

"Output tokens/s" divides each provider's reported output-token accounting by its full reported response duration. This avoids assigning hidden reasoning tokens to the tiny interval after the first visible token. Providers still differ in whether hidden reasoning is counted, so the metric is diagnostic rather than a fair cross-provider speed score. Visible word counts are included as a provider-neutral output-size measure. Cost is provider-reported; zero may mean pricing metadata is unavailable.

## Open-ended output quality audit

${quality}

The rubric is deterministic and published in the source report. It rewards requested identity/context grounding, useful capability coverage, evidence discipline, and directness. It does not use any benchmarked model to judge itself. Exact-response and tool scenarios receive quality credit only when their full contract passes.

## Representative produced outputs

${responses}

## Methodology

- Quality: ${analysis.methodology.quality}
- Reliability: ${analysis.methodology.reliability}
- Speed: ${analysis.methodology.speed}
- Balanced: ${analysis.methodology.balanced}
- Variability: ${analysis.methodology.variability}
- Cost: ${analysis.methodology.cost}
`.replace(/[ \t]+$/gmu, "");
}

function readValue(args: string[], index: number, name: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
	return value;
}

function defaultOutput(inputFile: string, extension: string): string {
	return inputFile.endsWith(".json") ? `${inputFile.slice(0, -5)}.analysis.${extension}` : `${inputFile}.analysis.${extension}`;
}

function parseArgs(args: string[]): CliOptions {
	const inputFile = args[0];
	if (!inputFile || inputFile.startsWith("--")) {
		throw new Error("Usage: bun packages/coding-agent/bench/model-scenario-analysis.ts REPORT [--json FILE] [--markdown FILE]");
	}
	let jsonFile = defaultOutput(inputFile, "json");
	let markdownFile = defaultOutput(inputFile, "md");
	for (let index = 1; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--json") {
			jsonFile = readValue(args, index, argument);
			index++;
		} else if (argument === "--markdown") {
			markdownFile = readValue(args, index, argument);
			index++;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return {
		inputFile: path.resolve(inputFile),
		jsonFile: path.resolve(jsonFile),
		markdownFile: path.resolve(markdownFile),
	};
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const report = (await Bun.file(options.inputFile).json()) as ScenarioBenchmarkReport;
	const analysis = analyzeScenarioBenchmarkReport(report);
	await Promise.all([
		Bun.write(options.jsonFile, `${JSON.stringify(analysis, null, 2)}\n`),
		Bun.write(options.markdownFile, renderScenarioBenchmarkAnalysis(analysis, report)),
	]);
	process.stdout.write(`Analysis JSON: ${options.jsonFile}\nAnalysis Markdown: ${options.markdownFile}\n`);
}

if (import.meta.main) {
	main().catch(error => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
