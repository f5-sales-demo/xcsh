import { expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import type { SandboxCheckReport } from "../src/cli/sandbox-check";
import { Settings } from "../src/config/settings";
import { _resetShellSessionsForTest } from "../src/exec/bash-executor";
import { SANDBOX_OPERATOR_HOME_ENV, SANDBOX_SESSION_ROOT_ENV } from "../src/sandbox/session-fence";
import type { ToolSession } from "../src/tools";
import { BashTool } from "../src/tools/bash";

const cli = path.resolve(import.meta.dir, "../src/cli.ts");

function assertHealthyReport(report: SandboxCheckReport): void {
	expect(["seatbelt", "landlock", "scanner-only"]).toContain(report.backend);
	expect(report.summary.failed).toBe(0);
	expect(report.checks).toHaveLength(10);
	expect(report.checks).toContainEqual({ name: "structured tools share the boundary", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "cwd resets across tool calls", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "synthetic fixtures removed", status: "PASS" });
	if (report.osEnforced) {
		expect(report.summary).toEqual({ passed: 10, failed: 0, skipped: 0 });
		expect(report.checks).toContainEqual({ name: "account container cannot be enumerated", status: "PASS" });
		expect(report.checks).toContainEqual({ name: "synthetic other account cannot be entered", status: "PASS" });
	}
}

it("runs the standalone installed-process matrix and verifies fixture cleanup", async () => {
	const result = await $`bun ${cli} sandbox check --json`.quiet().nothrow();
	const report = JSON.parse(result.stdout.toString()) as SandboxCheckReport;

	expect(result.exitCode).toBe(0);
	assertHealthyReport(report);
}, 30_000);

it("reports a healthy matrix when invoked inside the live bash profile", async () => {
	const container = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sandbox-check-live-")));
	const workspace = path.join(container, "workspace");
	fs.mkdirSync(workspace);
	const session = {
		cwd: workspace,
		hasUI: false,
		hasEditTool: true,
		settings: Settings.isolated({
			"async.enabled": false,
			"bash.autoBackground.enabled": false,
			"bashInterceptor.enabled": false,
			"sandbox.enabled": true,
		}),
		getSessionId: () => "sandbox-check-nested-profile",
	} as ToolSession;
	const bash = new BashTool(session);

	try {
		const result = await bash.execute("sandbox-check-nested", {
			command: `${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} sandbox check --json`,
			cwd: fs.realpathSync(os.tmpdir()),
		});
		const output = result.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map(part => part.text)
			.join("")
			.trim();
		const report = JSON.parse(output) as SandboxCheckReport;
		assertHealthyReport(report);
	} finally {
		_resetShellSessionsForTest();
		fs.rmSync(container, { recursive: true, force: true });
	}
}, 30_000);

it("reports generalized assertion, path, and errno details for a failed probe", async () => {
	const container = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sandbox-check-detail-")));
	const workspace = path.join(container, "workspace");
	const invalidHome = path.join(container, "not-a-directory");
	fs.mkdirSync(workspace);
	fs.writeFileSync(invalidHome, "fixture\n");
	const env = {
		...process.env,
		[SANDBOX_SESSION_ROOT_ENV]: workspace,
		[SANDBOX_OPERATOR_HOME_ENV]: invalidHome,
	};

	try {
		const jsonResult = await $`bun ${cli} sandbox check --json`.env(env).quiet().nothrow();
		const report = JSON.parse(jsonResult.stdout.toString()) as SandboxCheckReport;
		const failure = report.checks.find(check => check.name === "operator home configuration is writable");

		expect(jsonResult.exitCode).toBe(1);
		expect(failure?.status).toBe("FAIL");
		expect(failure?.detail).toContain("create operator-home fixture");
		expect(failure?.detail).toContain("path=<operator-home>/<synthetic-fixture>");
		expect(failure?.detail).toContain("errno=ENOTDIR");
		expect(failure?.detail).not.toContain(invalidHome);

		const verboseResult = await $`bun ${cli} sandbox check --verbose`.env(env).quiet().nothrow();
		const verbose = verboseResult.stdout.toString();
		expect(verboseResult.exitCode).toBe(1);
		expect(verbose).toContain("path=<operator-home>/<synthetic-fixture>");
		expect(verbose).toContain("errno=ENOTDIR");
		expect(verbose).not.toContain(invalidHome);
	} finally {
		fs.rmSync(container, { recursive: true, force: true });
	}
}, 30_000);
