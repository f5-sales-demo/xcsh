import { expect, it } from "bun:test";
import * as path from "node:path";
import { $ } from "bun";
import type { SandboxCheckReport } from "../src/cli/sandbox-check";

it("runs the installed-process sandbox matrix and verifies fixture cleanup", async () => {
	const cli = path.resolve(import.meta.dir, "../src/cli.ts");
	const result = await $`bun ${cli} sandbox check --json`.quiet().nothrow();
	const report = JSON.parse(result.stdout.toString()) as SandboxCheckReport;

	expect(result.exitCode).toBe(0);
	expect(["seatbelt", "landlock", "scanner-only"]).toContain(report.backend);
	expect(report.summary.failed).toBe(0);
	expect(report.checks).toContainEqual({ name: "structured tools share the boundary", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "cwd resets across tool calls", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "synthetic fixtures removed", status: "PASS" });
	if (report.osEnforced) {
		expect(report.checks).toContainEqual({ name: "account container cannot be enumerated", status: "PASS" });
		expect(report.checks).toContainEqual({ name: "synthetic other account cannot be entered", status: "PASS" });
	}
}, 20_000);
