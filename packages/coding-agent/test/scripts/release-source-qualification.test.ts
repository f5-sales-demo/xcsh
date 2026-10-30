import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../../../scripts/ci-qualify-release-source.sh");
const names = [
	"check",
	"TypeScript tests (native-independent)",
	"TypeScript tests (native-dependent)",
	"Test installation methods",
	"Native build (linux, x64, baseline)",
	"Native build (linux, x64, modern)",
	"Native build (ubuntu-24.04, arm64)",
	"Native build (macos-26-intel, x64)",
	"Native build (macos-26-intel, x64)",
	"Native build (macos-latest, arm64)",
	"Native build (windows-latest, x64)",
	"Native build (windows-latest, x64)",
];
const green = names.map((name, id) => ({ id, name, conclusion: "success" }));
type Job = (typeof green)[number];

async function qualify(attempts: Job[][], apiFailure = false) {
	const root = await mkdtemp(join(tmpdir(), "xcsh-source-jobs-"));
	try {
		const gh = join(root, "gh");
		await writeFile(
			gh,
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture is interpreted by Bash.
			'#!/bin/bash\nset -euo pipefail\n[[ "${API_FAILURE:-}" != true ]] || exit 1\nuri=$2\nattempt=${uri#*/attempts/}\nattempt=${attempt%%/*}\ncat "$RESPONSE_ROOT/$attempt.json"\n',
		);
		await chmod(gh, 0o755);
		for (const [index, jobs] of attempts.entries()) {
			// Exercise pagination: the duplicate Intel/Windows variants cross page boundaries.
			await writeFile(
				join(root, `${index + 1}.json`),
				JSON.stringify([{ jobs: jobs.slice(0, 8) }, { jobs: jobs.slice(8) }]),
			);
		}
		const child = Bun.spawn(["bash", script, "synthetic/repo", "123", String(attempts.length)], {
			env: {
				...process.env,
				PATH: `${root}:${process.env.PATH}`,
				RESPONSE_ROOT: root,
				API_FAILURE: String(apiFailure),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return { code, stdout, stderr };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("qualifies a repaired complete attempt without dropping duplicate matrix variants", async () => {
	const failed = green.map((job, index) => (index === 8 ? { ...job, conclusion: "failure" } : job));
	const result = await qualify([failed, green]);
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain("Qualified source run 123 attempt 2");
});

test("signing-only retries retain a complete successful original qualification", async () => {
	const result = await qualify([green, [{ id: 30, name: "Build and sign macOS (x64)", conclusion: "success" }]]);
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain("Qualified source run 123 attempt 1");
});

test("rejects incomplete, duplicated, failed, or mixed-attempt prerequisites", async () => {
	for (const attempts of [
		[green.filter((_, index) => index !== 8)],
		[[...green, green[8]!]],
		[green.map((job, index) => (index === 8 ? { ...job, conclusion: "failure" } : job))],
		[green.slice(0, 8), green.slice(8)],
	]) {
		const result = await qualify(attempts);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("lacks a complete successful prerequisite attempt");
	}
});

test("an API failure fails closed even when an earlier attempt could qualify", async () => {
	expect((await qualify([green, green], true)).code).not.toBe(0);
});
