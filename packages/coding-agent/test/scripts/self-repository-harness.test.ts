import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parse } from "yaml";

const root = path.resolve(import.meta.dir, "../../../..");

async function run(command: string[], cwd: string, env = process.env) {
	const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest("self-repository controller executes only the matching frozen harness", async () => {
	const folder = await mkdtemp(path.join(tmpdir(), "xcsh-frozen-harness-"));
	const workspace = path.join(folder, "source");
	const harness = path.join(workspace, ".qualification-harness");
	const cachedAction = path.join(folder, "cached-action");
	const marker = path.join(folder, "executed");
	try {
		await mkdir(path.join(workspace, "scripts"), { recursive: true });
		await mkdir(cachedAction);
		await writeFile(
			path.join(workspace, "scripts/prepare-runner-optimization-toolchain.sh"),
			'#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s" "$5" > "$MARKER_PATH"\n',
			{ mode: 0o755 },
		);
		const git = [
			"git",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=noreply@example.com",
		];
		for (const args of [
			["init", "-q"],
			["add", "."],
			["commit", "-qm", "fixture"],
		]) {
			expect((await run([...git, ...args], workspace)).code).toBe(0);
		}
		const source = (await run(["git", "rev-parse", "HEAD"], workspace)).stdout.trim();
		expect((await run(["git", "clone", "--quiet", workspace, harness], folder)).code).toBe(0);
		const action = parse(
			await Bun.file(path.join(root, ".github/actions/runner-optimization-profile/action.yml")).text(),
		);
		const step = action.runs.steps.find(
			(item: { name: string }) => item.name === "Profile legacy setup or baked verification",
		);
		const env = {
			...process.env,
			PROFILE_ACTION_ROOT: cachedAction,
			PROFILE_HARNESS_ROOT: harness,
			PROFILE_SOURCE_SHA: source,
			PROFILE_EXPERIMENT: "image-control",
			PROFILE_CACHE_STATE: "cold",
			PROFILE_PAIR_ID: "fixture",
			PROFILE_PHASE_SET: "native",
			RUNNER_TEMP: folder,
			MARKER_PATH: marker,
		};
		const invoke = () => run(["bash", "-euo", "pipefail", "-c", step.run], workspace, env);
		const accepted = await invoke();
		expect(accepted.stderr).toBe("");
		expect(accepted.code).toBe(0);
		expect(await Bun.file(marker).text()).toBe(path.join(harness, "scripts/verify-self-hosted-tools.sh"));
		await rm(marker);
		expect((await run([...git, "commit", "--allow-empty", "-qm", "different harness"], harness)).code).toBe(0);
		const rejected = await invoke();
		expect(rejected.code).not.toBe(0);
		expect(rejected.stderr).toContain("qualification harness SHA");
		expect(await Bun.file(marker).exists()).toBe(false);
		const wrongSource = await run(["bash", "-euo", "pipefail", "-c", step.run], workspace, {
			...env,
			PROFILE_SOURCE_SHA: "0".repeat(40),
		});
		expect(wrongSource.code).not.toBe(0);
		expect(wrongSource.stderr).toContain("checked-out source SHA");
		expect(await Bun.file(marker).exists()).toBe(false);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
});
