import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "yaml";
import { validateRecoveryBinding, verifyRecoveryFiles } from "../../../../scripts/release-recovery-binding";

const root = path.resolve(import.meta.dir, "../../../..");
const expected = { tag: "v23.3.4", sourceSha: "a".repeat(40), controllerSha: "b".repeat(40), sourceRunId: "12345" };
const names = [
	"pi_natives.darwin-x64-baseline.node",
	"pi_natives.darwin-x64-modern.node",
	"xcsh-darwin-x64",
	"xcsh-darwin-x64.pkg",
	"xcsh-darwin-x64.provenance.json",
];
const receipt = () => ({
	version: 1,
	arch: "x64",
	...expected,
	files: Object.fromEntries(
		names.map(n => [n, `sha256:${createHash("sha256").update("verified bytes").digest("hex")}`]),
	),
});
describe("exact-tag signed release recovery", () => {
	it("isolates non-cancellable exact-tag recovery from main CI pushes", async () => {
		const ci = parse(await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"));
		expect(ci.concurrency.group).toContain("macos-recovery-{1}");
		expect(ci.concurrency.group).toContain("inputs.macos_recovery_tag");
		expect(ci.concurrency["cancel-in-progress"]).toContain("!inputs.macos_recovery_tag");
	});

	it("writes an exact source SHA and rejects mismatched normal-build identity", async () => {
		const ci = parse(await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"));
		const step = ci.jobs["build-sign-macos"].steps.find(
			(s: any) => s.name === "Verify source and canonical artifact identity",
		);
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "source-gate-"));
		try {
			const sha = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();
			const env = {
				...process.env,
				RECOVERY: "false",
				SOURCE_REF: sha,
				SOURCE_RUN_ID: "123",
				GITHUB_SHA: sha,
				GITHUB_RUN_ID: "123",
				GITHUB_ENV: path.join(dir, "env"),
			};
			const accepted = Bun.spawnSync(["bash", "-c", step.run], { cwd: root, env });
			expect(accepted.exitCode).toBe(0);
			expect(await fs.readFile(env.GITHUB_ENV, "utf8")).toBe(`SOURCE_SHA=${sha}\n`);
			const rejected = Bun.spawnSync(["bash", "-c", step.run], {
				cwd: root,
				env: { ...env, SOURCE_REF: "mismatch" },
			});
			expect(rejected.exitCode).not.toBe(0);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("binds every source identity and rejects missing/extra asset membership", () => {
		expect(validateRecoveryBinding(receipt(), expected).tag).toBe(expected.tag);
		for (const key of Object.keys(expected)) {
			const b: any = receipt();
			b[key] = "mismatch";
			expect(() => validateRecoveryBinding(b, expected)).toThrow();
		}
		const b = receipt();
		delete b.files[names[0]!];
		expect(() => validateRecoveryBinding(b, expected)).toThrow();
		const extra = receipt();
		extra.files.other = extra.files[names[0]!]!;
		expect(() => validateRecoveryBinding(extra, expected)).toThrow();
	});
	it("verifies recovered payload bytes before publication", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recovery-bytes-"));
		try {
			for (const n of names) await fs.writeFile(path.join(dir, n), "verified bytes");
			const b = validateRecoveryBinding(receipt(), expected);
			await verifyRecoveryFiles(b, dir);
			await fs.writeFile(path.join(dir, names[0]!), "changed");
			await expect(verifyRecoveryFiles(b, dir)).rejects.toThrow("digest mismatch");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
	it("uses the approved signing job with exact source and trusted retry helper", async () => {
		const ci = parse(await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"));
		const job = ci.jobs["build-sign-macos"];
		const steps = job.steps;
		expect(job["runs-on"]).toBe("$" + "{{ matrix.os }}");
		expect(steps[0].with.ref).toBe("$" + "{{ inputs.macos_recovery_tag || github.sha }}");
		const verify = steps.find((s: any) => s.name === "Verify source and canonical artifact identity");
		expect(steps.indexOf(verify)).toBeLessThan(
			steps.findIndex((s: any) => s.name === "Import Code Signing Certificate"),
		);
		expect(verify.run).toContain(".head_sha == $sha");
		const pkg = steps.find((s: any) => s.name === "Build, sign, notarize, and staple macOS package");
		expect(pkg.run).toContain('bash .controller/scripts/ci-staple-macos-pkg.sh "$pkg"');
		expect(pkg.run).toContain("spctl --assess");
		expect(pkg.run).toContain("--layout pkg");
		expect(steps.find((s: any) => s.name === "Record recovery artifact binding").if).toBe(
			"inputs.macos_recovery_tag != '' && matrix.arch == 'x64'",
		);
	});

	it("requires successful trusted recovery and exact receipt before backfill", async () => {
		const text = await fs.readFile(path.join(root, ".github/workflows/release-github-backfill.yml"), "utf8");
		expect(text).toContain('.path == ".github/workflows/ci.yml"');
		expect(text).toContain('.conclusion == "success"');
		expect(text.indexOf("Verify exact recovery source and bytes")).toBeLessThan(
			text.indexOf("Build deterministic archives twice"),
		);
		expect(text).toContain("release-recovery-binding.ts verify");
	});
});
