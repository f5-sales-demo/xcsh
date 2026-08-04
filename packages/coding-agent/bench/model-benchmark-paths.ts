import * as os from "node:os";
import * as path from "node:path";

export function defaultModelBenchmarkOutputFile(prefix: string, createdAt: string, processId = process.pid): string {
	const timestamp = createdAt.replaceAll(":", "-");
	return path.join(os.homedir(), ".xcsh", "benchmarks", `${prefix}-${timestamp}-${processId}.json`);
}

export function displayModelBenchmarkOutputFile(outputFile: string): string {
	const homeDirectory = os.homedir();
	if (outputFile === homeDirectory) return "~";
	if (outputFile.startsWith(`${homeDirectory}${path.sep}`)) return `~${outputFile.slice(homeDirectory.length)}`;
	return outputFile;
}
