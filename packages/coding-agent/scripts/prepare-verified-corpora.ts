#!/usr/bin/env bun
import path from "node:path";

export interface CorpusPreparationOperations {
	refresh: () => Promise<void>;
	generate: (name: string, arguments_: readonly string[]) => Promise<void>;
	citations: () => Promise<void>;
	verify: () => Promise<void>;
}

export async function prepareVerifiedCorpora(operations: CorpusPreparationOperations): Promise<void> {
	await operations.refresh();
	for (const [name, arguments_] of [
		["generate-api-spec-index", []],
		["generate-api-catalog-qmd-index", []],
		["generate-documentation-index", ["--update-pin"]],
		["generate-terraform-documentation-index", ["--update-pin"]],
		["generate-terraform-index", []],
	] as const)
		await operations.generate(name, arguments_);
	await operations.citations();
	await operations.verify();
}

const packageRoot = path.resolve(import.meta.dir, "..");
async function run(command: readonly string[]): Promise<void> {
	const child = Bun.spawn([...command], { cwd: packageRoot, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	const code = await child.exited;
	if (code !== 0) throw new Error(`Corpus preparation failed (${code}): ${command.join(" ")}`);
}

if (import.meta.main) {
	const { refreshCorpusSources } = await import("./refresh-corpus-sources");
	const { preparePublicCitations } = await import("./prepare-public-citations");
	await prepareVerifiedCorpora({
		refresh: () => refreshCorpusSources(),
		generate: (name, arguments_) => run([process.execPath, "run", name, ...arguments_]),
		citations: () => preparePublicCitations(),
		// Load newly generated exports in a separate process; the parent may have
		// imported an older mapping before preparation began.
		verify: () => run([process.execPath, "scripts/check-corpus-freshness.ts"]),
	});
}
