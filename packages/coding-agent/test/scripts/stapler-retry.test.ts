import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const script = path.resolve(import.meta.dir, "../../../../scripts/ci-staple-macos-pkg.sh");
let root: string;
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "stapler-test-"));
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});
async function run(mode: string) {
	const pkg = path.join(root, "package with spaces.pkg");
	await fs.writeFile(pkg, "fixture");
	const fake = path.join(root, "xcrun");
	await fs.writeFile(
		fake,
		`#!/usr/bin/env bash
set -eu
printf '%s|%s|%s\\n' "$1" "$2" "$3" >> "$TEST_ROOT/calls"
count_file="$TEST_ROOT/$2.count"
count=0; test ! -f "$count_file" || count=$(cat "$count_file")
count=$((count+1)); echo "$count" > "$count_file"
if [ "$MODE" = permanent ]; then echo 'Invalid package signature'; exit 65; fi
if [ "$MODE" = exhausted ] || { [ "$MODE" = transient ] && [ "$count" -lt 3 ]; }; then echo 'NSURLErrorDomain Code=-1005: The network connection was lost. CloudKit'; exit 68; fi
exit 0
`,
		{ mode: 0o700 },
	);
	const child = Bun.spawn(["bash", script, pkg], {
		env: {
			...process.env,
			PATH: `${root}:${process.env.PATH}`,
			TEST_ROOT: root,
			MODE: mode,
			XCSH_STAPLER_INITIAL_DELAY_SECONDS: "0",
			XCSH_STAPLER_MAX_ATTEMPTS: "3",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	let calls: string[] = [];
	try {
		calls = (await fs.readFile(path.join(root, "calls"), "utf8")).trim().split("\n");
	} catch {}
	return { code, text: stdout + stderr, calls, pkg };
}
describe("bounded macOS ticket delivery", () => {
	it("retries staple and validation separately without notarization or argv changes", async () => {
		const r = await run("transient");
		expect(r.code).toBe(0);
		expect(r.calls).toEqual([
			...Array(3).fill(`stapler|staple|${r.pkg}`),
			...Array(3).fill(`stapler|validate|${r.pkg}`),
		]);
		expect(r.text).not.toContain("notarytool");
	});
	it("fails after a bounded number of transient attempts", async () => {
		const r = await run("exhausted");
		expect(r.code).toBe(68);
		expect(r.calls).toHaveLength(3);
		expect(r.text).toContain("exhausted");
	});
	it("does not retry permanent failures", async () => {
		const r = await run("permanent");
		expect(r.code).toBe(65);
		expect(r.calls).toHaveLength(1);
	});
	it("rejects unsafe retry settings before contacting Apple", async () => {
		process.env.XCSH_STAPLER_MAX_ATTEMPTS = "0";
		const child = Bun.spawn(["bash", script, "missing.pkg"], { stdout: "pipe", stderr: "pipe" });
		expect(await child.exited).not.toBe(0);
		delete process.env.XCSH_STAPLER_MAX_ATTEMPTS;
	});
});
