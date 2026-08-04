/** Re-evaluate stored responses and tool traces after a benchmark-contract correction. */
import * as path from "node:path";
import { MODEL_BENCHMARK_SCENARIOS } from "./model-scenario-library";
import { regradeScenarioBenchmarkReport, type ScenarioBenchmarkReport } from "./model-scenario-report";

function readValue(args: string[], index: number, name: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
	return value;
}

function parseArgs(args: string[]): { inputFile: string; outputFile: string } {
	const input = args[0];
	if (!input || input.startsWith("--")) {
		throw new Error("Usage: bun packages/coding-agent/bench/model-scenario-regrade.ts REPORT [--out FILE]");
	}
	let output = input;
	for (let index = 1; index < args.length; index++) {
		if (args[index] !== "--out") throw new Error(`Unknown argument: ${args[index]}`);
		output = readValue(args, index, "--out");
		index++;
	}
	return { inputFile: path.resolve(input), outputFile: path.resolve(output) };
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const report = (await Bun.file(options.inputFile).json()) as ScenarioBenchmarkReport;
	const reevaluated = regradeScenarioBenchmarkReport(report, MODEL_BENCHMARK_SCENARIOS);
	await Bun.write(options.outputFile, `${JSON.stringify(reevaluated, null, 2)}\n`);
	process.stdout.write(`Re-evaluated report: ${options.outputFile}\n`);
}

if (import.meta.main) {
	main().catch(error => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
