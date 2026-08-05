import { expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { $ } from "bun";
import type { SandboxCheckReport } from "../src/cli/sandbox-check";
import { Settings } from "../src/config/settings";
import { _resetShellSessionsForTest } from "../src/exec/bash-executor";
import {
	SANDBOX_CHECK_NAMED_SIBLING_ENV,
	SANDBOX_OPERATOR_HOME_ENV,
	SANDBOX_SESSION_ROOT_ENV,
} from "../src/sandbox/session-fence";
import type { ToolSession } from "../src/tools";
import { BashTool, type BashToolDetails } from "../src/tools/bash";

const cli = path.resolve(import.meta.dir, "../src/cli.ts");
const sandboxCheckExecutable = process.env.XCSH_TEST_SANDBOX_CHECK_BINARY;

function sandboxCommand(args: string[], prefixFlags: string[] = []): string {
	const argv = sandboxCheckExecutable === undefined ? [process.execPath, cli] : [sandboxCheckExecutable];
	return [...argv, ...prefixFlags, "sandbox", ...args].map(value => JSON.stringify(value)).join(" ");
}

function sandboxCheckCommand(flags: string[] = [], prefixFlags: string[] = []): string {
	return sandboxCommand(["check", ...flags], prefixFlags);
}

async function runSandboxCheckProcess(
	flags: string[],
	env: Record<string, string | undefined> = process.env,
	cwd = process.cwd(),
): Promise<$.ShellOutput> {
	return await $`${{ raw: sandboxCheckCommand(flags) }}`.cwd(cwd).env(env).quiet().nothrow();
}

function resultText(result: AgentToolResult<BashToolDetails>): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map(part => part.text)
		.join("")
		.trim();
}

function createSession(workspace: string): ToolSession {
	return {
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
}

async function runInsideLiveProfile(
	workspace: string,
	attemptContextOverride = false,
	prefixFlags: string[] = [],
): Promise<SandboxCheckReport> {
	const bash = new BashTool(createSession(workspace));
	const result = await bash.execute("sandbox-check-nested", {
		command: sandboxCheckCommand(["--json"], prefixFlags),
		cwd: fs.realpathSync(os.tmpdir()),
		...(attemptContextOverride
			? {
					env: {
						[SANDBOX_CHECK_NAMED_SIBLING_ENV]: path.join(workspace, "bogus-sibling"),
						[SANDBOX_SESSION_ROOT_ENV]: path.join(workspace, "bogus-root"),
						[SANDBOX_OPERATOR_HOME_ENV]: path.join(workspace, "bogus-home"),
					},
				}
			: {}),
	});
	return JSON.parse(resultText(result)) as SandboxCheckReport;
}

function assertHealthyReport(report: SandboxCheckReport): void {
	expect(["seatbelt", "landlock", "scanner-only"]).toContain(report.backend);
	expect(report.summary.failed).toBe(0);
	expect(report.summary.errors).toBe(0);
	expect(report.checks).toHaveLength(17);
	expect(report.checks).toContainEqual({ name: "structured tools share the boundary", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "Bash grep pattern remains data (#2931)", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "Bash Python heredoc remains data (#2931)", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "cwd resets across tool calls", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "system temp supports direct file creation", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "system temp remains enumerable", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "operator home remains enumerable", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "filesystem root remains enumerable", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "operator home supports direct file creation", status: "PASS" });
	expect(report.checks).toContainEqual({ name: "synthetic fixtures removed", status: "PASS" });
	if (report.osEnforced) {
		expect(report.summary).toEqual({ passed: 17, failed: 0, errors: 0, skipped: 0 });
		expect(report.checks).toContainEqual({ name: "account container cannot be enumerated", status: "PASS" });
		expect(report.checks).toContainEqual({ name: "named other account remains reachable", status: "PASS" });
		expect(report.checks).toContainEqual({ name: "explicit grant restores parent enumeration", status: "PASS" });
	}
}

it("runs the flag-free sandbox check named by launch-flag diagnostics and verifies fixture cleanup", async () => {
	const result = await runSandboxCheckProcess(["--json"]);
	const report = JSON.parse(result.stdout.toString()) as SandboxCheckReport;

	expect(result.exitCode).toBe(0);
	assertHealthyReport(report);
}, 30_000);

it("reports a healthy matrix when invoked from operator home", async () => {
	const home = fs.realpathSync(os.homedir());
	const result = await runSandboxCheckProcess(["--json"], process.env, home);
	const report = JSON.parse(result.stdout.toString()) as SandboxCheckReport;

	expect(result.exitCode).toBe(0);
	assertHealthyReport(report);
}, 30_000);

it("rejects launch flags on either side of the installed sandbox subcommand with one scope diagnostic", async () => {
	const home = fs.realpathSync(os.homedir());
	const workspace = fs.realpathSync(fs.mkdtempSync(path.join(home, ".xcsh-sandbox-check-prefix-flags-")));
	try {
		const launchFlags = ["--no-sandbox", "--allow-path", fs.realpathSync(os.tmpdir())];
		const commands = [sandboxCheckCommand([], launchFlags), sandboxCheckCommand(launchFlags)];
		const messages: string[] = [];
		for (const command of commands) {
			const bash = new BashTool(createSession(workspace));
			let message = "";
			try {
				await bash.execute("sandbox-check-invalid-scope", { command });
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}
			messages.push(message);
			expect(message).toContain("Launch flags --no-sandbox, --allow-path apply to an agent session");
			expect(message).toContain("not to `sandbox check`");
			expect(message).toContain("Run `xcsh sandbox check` without launch flags");
			expect(message).toContain("explicit grant restores parent enumeration");
			expect(message).toContain("Command exited with code 2");
			expect(message).not.toContain("Uncaught Exception");
			expect(message).not.toContain("realpathSync");
			expect(message).not.toContain(home);
		}
		expect(messages[0]).toBe(messages[1]);
	} finally {
		_resetShellSessionsForTest();
		fs.rmSync(workspace, { recursive: true, force: true });
		expect(fs.existsSync(workspace)).toBe(false);
	}
}, 30_000);

it("renders sandbox help when sandbox launch flags precede the subcommand", async () => {
	for (const prefixFlags of [["--no-sandbox"], ["--allow-path", fs.realpathSync(os.tmpdir())]]) {
		const result = await $`${{ raw: sandboxCommand(["--help"], prefixFlags) }}`.quiet().nothrow();
		const output = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(output).toContain("Verify the installed filesystem sandbox");
		expect(output).toContain("sandbox [ACTION] [FLAGS]");
		expect(output).not.toContain("COMMANDS");
	}
}, 30_000);

it("reports a healthy matrix when invoked inside the live bash profile", async () => {
	const container = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sandbox-check-live-")));
	const workspace = path.join(container, "workspace");
	fs.mkdirSync(workspace);
	try {
		assertHealthyReport(await runInsideLiveProfile(workspace));
	} finally {
		_resetShellSessionsForTest();
		fs.rmSync(container, { recursive: true, force: true });
	}
}, 30_000);

it("reports a healthy matrix for a live session rooted at operator home", async () => {
	const home = fs.realpathSync(os.homedir());
	const liveSiblingPrefix = ".xcsh-sandbox-check-live-sibling-";
	const liveSiblingCount = (): number =>
		fs.readdirSync(home).filter(entry => entry.startsWith(liveSiblingPrefix)).length;
	const liveSiblingCountBefore = liveSiblingCount();

	try {
		assertHealthyReport(await runInsideLiveProfile(home));
	} finally {
		_resetShellSessionsForTest();
		expect(liveSiblingCount()).toBe(liveSiblingCountBefore);
	}
}, 30_000);

it("reports a healthy matrix for a live session rooted directly inside operator home", async () => {
	const home = fs.realpathSync(os.homedir());
	const fixturePaths: string[] = [];
	const liveSiblingPrefix = ".xcsh-sandbox-check-live-sibling-";
	const liveSiblingCount = (): number =>
		fs.readdirSync(home).filter(entry => entry.startsWith(liveSiblingPrefix)).length;
	const liveSiblingCountBefore = liveSiblingCount();
	const createFixture = (prefix: string): string => {
		const fixture = fs.realpathSync(fs.mkdtempSync(path.join(home, prefix)));
		fixturePaths.push(fixture);
		return fixture;
	};

	try {
		const workspace = createFixture(".xcsh-sandbox-check-home-child-");
		const sibling = createFixture(".xcsh-sandbox-check-named-sibling-");
		const configFixture = createFixture(".xcsh-sandbox-check-config-");
		fs.writeFileSync(path.join(sibling, "named.txt"), "sibling\n");
		const bash = new BashTool(createSession(workspace));

		// The context variables are host-owned; model-supplied replacements must not move the probes.
		const liveReport = await runInsideLiveProfile(workspace, true);
		assertHealthyReport(liveReport);

		await bash.execute("sandbox-check-workspace-capability", {
			command: "printf own > own.txt && printf '%s\\n' ./* > /dev/null && find . -type f > /dev/null",
		});
		expect(fs.readFileSync(path.join(workspace, "own.txt"), "utf8")).toBe("own");

		const siblingRead = await bash.execute("sandbox-check-sibling-capability", {
			command: 'test "$(cat named.txt)" = sibling',
			cwd: sibling,
		});
		expect(resultText(siblingRead)).toBe("(no output)");

		await bash.execute("sandbox-check-config-capability", {
			command: "printf operator > config",
			cwd: configFixture,
		});
		expect(fs.readFileSync(path.join(configFixture, "config"), "utf8")).toBe("operator");

		let parentEnumerationDenied = false;
		try {
			await bash.execute("sandbox-check-parent-enumeration", {
				command: `ls ${JSON.stringify(home)} > /dev/null`,
			});
		} catch {
			parentEnumerationDenied = true;
		}
		expect(parentEnumerationDenied).toBe(false);
	} finally {
		_resetShellSessionsForTest();
		expect(liveSiblingCount()).toBe(liveSiblingCountBefore);
		for (const fixture of fixturePaths) {
			fs.rmSync(fixture, { recursive: true, force: true });
			expect(fs.existsSync(fixture)).toBe(false);
		}
	}
}, 30_000);

it("distinguishes setup errors from sandbox failures and skips empty cleanup", async () => {
	const container = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sandbox-check-setup-")));
	const missingWorkspace = path.join(container, "missing-workspace");
	const env = {
		...process.env,
		[SANDBOX_SESSION_ROOT_ENV]: missingWorkspace,
		[SANDBOX_OPERATOR_HOME_ENV]: container,
	};

	try {
		const jsonResult = await runSandboxCheckProcess(["--json"], env);
		const report = JSON.parse(jsonResult.stdout.toString()) as SandboxCheckReport;

		expect(jsonResult.exitCode).toBe(1);
		expect(report.summary).toEqual({ passed: 0, failed: 0, errors: 1, skipped: 1 });
		expect(report.checks[0]?.name).toBe("conformance matrix setup");
		expect(report.checks[0]?.status).toBe("ERROR");
		expect(report.checks[0]?.detail).not.toContain(missingWorkspace);
		expect(report.checks[1]).toEqual({
			name: "synthetic fixtures removed",
			status: "SKIP",
			detail: "setup created no fixtures; path=<synthetic-fixtures>; errno=none",
		});

		const humanResult = await runSandboxCheckProcess([], env);
		const human = humanResult.stdout.toString();
		expect(humanResult.exitCode).toBe(1);
		expect(human).toContain("ERROR");
		expect(human).toContain("0 passed, 0 failed, 1 errors, 1 skipped");
		expect(human).toContain("Conformance matrix did not run.");
	} finally {
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
		const jsonResult = await runSandboxCheckProcess(["--json"], env);
		const report = JSON.parse(jsonResult.stdout.toString()) as SandboxCheckReport;
		const failure = report.checks.find(check => check.name === "operator home supports direct file creation");

		expect(jsonResult.exitCode).toBe(1);
		expect(failure?.status).toBe("FAIL");
		expect(failure?.detail).toContain("direct operator-home creation");
		expect(failure?.detail).toContain("path=<operator-home>/<synthetic-fixture>");
		expect(failure?.detail).toContain("errno=ENOTDIR");
		expect(failure?.detail).not.toContain(invalidHome);

		const verboseResult = await runSandboxCheckProcess(["--verbose"], env);
		const verbose = verboseResult.stdout.toString();
		expect(verboseResult.exitCode).toBe(1);
		expect(verbose).toContain("path=<operator-home>/<synthetic-fixture>");
		expect(verbose).toContain("errno=ENOTDIR");
		expect(verbose).not.toContain(invalidHome);
	} finally {
		fs.rmSync(container, { recursive: true, force: true });
	}
}, 60_000);
