import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { validateRecoveryRun } from "../../../../scripts/release-recovery-binding";

const run = () => ({
	id: 12345,
	event: "workflow_dispatch",
	head_branch: "main",
	path: ".github/workflows/ci.yml",
	status: "completed",
	conclusion: "failure",
	head_sha: "a".repeat(40),
});
const jobs = () => ({
	jobs: [
		{ name: "Build and sign macOS (x64)", run_id: 12345, status: "completed", conclusion: "success" },
		{ name: "Prepare automatic release", run_id: 12345, status: "completed", conclusion: "failure" },
	],
});
describe("signing-specific recovery evidence", () => {
	it("accepts completed verified signing despite unrelated coordinator failure", () =>
		expect(validateRecoveryRun(run(), jobs())).toBe("a".repeat(40)));
	it("rejects an incomplete, failed, duplicate or absent signing job", () => {
		for (const status of ["failure", "skipped", null]) {
			const j: any = jobs();
			j.jobs[0].conclusion = status;
			expect(() => validateRecoveryRun(run(), j)).toThrow();
		}
		const j = jobs();
		j.jobs.push(j.jobs[0]!);
		expect(() => validateRecoveryRun(run(), j)).toThrow();
		expect(() => validateRecoveryRun(run(), { jobs: [] })).toThrow();
		const pending = run();
		pending.status = "in_progress";
		expect(() => validateRecoveryRun(pending, jobs())).toThrow();
	});
	it("rejects the wrong workflow, branch, event, commit or job run", () => {
		for (const key of ["event", "head_branch", "path", "head_sha"]) {
			const r: any = run();
			r[key] = "mismatch";
			expect(() => validateRecoveryRun(r, jobs())).toThrow();
		}
		const j = jobs();
		j.jobs[0]!.run_id = 54321;
		expect(() => validateRecoveryRun(run(), j)).toThrow();
	});
	it("keeps automatic new-release preparation out of exact-tag recovery", async () => {
		const file = path.resolve(import.meta.dir, "../../../../.github/workflows/ci.yml");
		const workflow = parse(await readFile(file, "utf8"));
		expect(workflow.jobs["auto-release"].if).toContain("!inputs.macos_recovery_tag");
	});
});
