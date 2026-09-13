import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const PRE_FIX_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const args = process.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
};
const baselineRoot = valueFor("--baseline-root");
const preFixRoot = valueFor("--pre-fix-root");
if (!baselineRoot || !preFixRoot)
	throw new Error(
		"Usage: bun capture-coding-agent-test-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const output = resolve(
	valueFor("--output") ??
		join(root, "packages/coding-agent/test/evidence/coding-agent-test-differential-v1/receipt.json"),
);

async function commit(directory: string): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: directory, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	if (exitCode !== 0) throw new Error(`Cannot resolve commit for ${directory}`);
	return stdout.trim();
}

async function run(directory: string, expectedCommit: string) {
	const actualCommit = await commit(directory);
	if (actualCommit !== expectedCommit)
		throw new Error(`Expected ${expectedCommit}, got ${actualCommit} in ${directory}`);
	const startedAt = new Date().toISOString();
	const child = Bun.spawn([process.execPath, "test", "packages/coding-agent/test"], {
		cwd: directory,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { commit: actualCommit, startedAt, exitCode, stdout, stderr };
}

const baseline = await run(resolve(baselineRoot), BASELINE_COMMIT);
const preFix = await run(resolve(preFixRoot), PRE_FIX_COMMIT);
await mkdir(resolve(output, ".."), { recursive: true });
await Bun.write(
	output,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			kind: "full-coding-agent-test-differential",
			baseline,
			preFix,
			limitation:
				"Broad source-contract evidence only. Passing test trees do not establish complete interactive slash-command behavioral parity.",
		},
		null,
	)}\n`,
);
console.log(JSON.stringify({ output, baselineExitCode: baseline.exitCode, preFixExitCode: preFix.exitCode }));
process.exitCode = baseline.exitCode || preFix.exitCode ? 1 : 0;
