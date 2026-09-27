import { describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderCommandHelp } from "@f5-sales-demo/pi-utils/cli";
import { getBrewUpgradeCommand, parseUpdateArgs } from "../src/cli/update-cli";
import SelfUpdate from "../src/commands/self-update";
import Update, { parseUpdateInvocation } from "../src/commands/update";

const codingAgentDir = import.meta.dir.replace(/\/test$/, "");
const updateFetchPreload = path.join(import.meta.dir, "fixtures", "update-fetch-preload.ts");

function runUpdateSubprocess(args: string[], pathValue?: string): ReturnType<typeof Bun.spawnSync> {
	return Bun.spawnSync([process.execPath, "--preload", updateFetchPreload, "src/cli.ts", "update", ...args], {
		cwd: codingAgentDir,
		env: { ...process.env, PATH: pathValue ?? process.env.PATH },
		stdout: "pipe",
		stderr: "pipe",
	});
}

function processOutput(result: ReturnType<typeof Bun.spawnSync>): { stdout: string; combined: string } {
	const stdout = result.stdout?.toString() ?? "";
	return { stdout, combined: `${stdout}${result.stderr?.toString() ?? ""}` };
}

describe("update command boundary", () => {
	it("keeps self-update as the explicit executable updater", () => {
		expect(parseUpdateArgs(["self-update", "--check"])).toEqual({ force: false, check: true });
		expect(parseUpdateArgs(["self-update", "--force"])).toEqual({ force: true, check: false });
	});

	it.each([
		["bare", [], { force: false, check: false }],
		["long check", ["--check"], { force: false, check: true }],
		["short check", ["-c"], { force: false, check: true }],
		["force", ["--force"], { force: true, check: false }],
	] as const)("routes %s update to executable updating", (_name, argv, expected) => {
		expect(parseUpdateInvocation([...argv])).toEqual({ mode: "executable", ...expected });
	});

	it.each([
		["short filename", ["-f", "manifest.yaml"]],
		["filename", ["--filename", "manifest.yaml"]],
		["inline filename", ["--filename=manifest.yaml"]],
		["namespace", ["--namespace", "demo"]],
		["short namespace", ["-n", "demo"]],
		["output", ["--output", "json"]],
		["short output", ["-o", "yaml"]],
		["recursive", ["--recursive"]],
		["short recursive", ["-R"]],
		["dry run", ["--dry-run", "client"]],
		["result file", ["--result-file", "report.json"]],
	] as const)("routes the %s manifest flag to resource updating", (_name, argv) => {
		expect(parseUpdateInvocation([...argv])).toMatchObject({ mode: "resource" });
	});

	it.each([
		[["--check", "-f", "manifest.yaml"]],
		[["-c", "--namespace", "demo"]],
		[["--force", "--dry-run", "client"]],
	])("rejects mixed executable and resource flags before dispatch", argv => {
		expect(() => parseUpdateInvocation(argv)).toThrow("cannot combine executable-update and resource-update flags");
	});

	it("rejects ambiguous, unknown, and positional update syntax as usage errors", () => {
		expect(() => parseUpdateInvocation(["-f"])).toThrow(
			"Ambiguous -f: use 'xcsh update --force' or 'xcsh self-update -f' for executable updates",
		);
		expect(() => parseUpdateInvocation(["--unknown"])).toThrow();
		expect(() => parseUpdateInvocation(["manifest.yaml"])).toThrow();
	});

	it("documents both compatibility modes and the -f distinction", () => {
		const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		try {
			renderCommandHelp("xcsh", "update", Update);
			const compatibilityUpdate = write.mock.calls.map(([chunk]) => String(chunk)).join("");
			write.mockClear();
			renderCommandHelp("xcsh", "self-update", SelfUpdate);
			const executableUpdate = write.mock.calls.map(([chunk]) => String(chunk)).join("");

			expect(compatibilityUpdate).toContain("Update resources or follow the xcsh executable installation channel");
			expect(compatibilityUpdate).toContain("-f, --filename=<value>");
			expect(compatibilityUpdate).toContain("--force");
			expect(compatibilityUpdate).toContain("xcsh self-update -f");
			expect(executableUpdate).toContain("Check for xcsh updates and follow the detected installation channel");
			expect(executableUpdate).toContain("--check");
		} finally {
			write.mockRestore();
		}
	});

	it.each([
		["bare", []],
		["check", ["--check"]],
		["short check", ["-c"]],
	])("fails closed for the %s executable form in an unproven source checkout", (_name, argv) => {
		const result = runUpdateSubprocess(argv);
		const { combined: output } = processOutput(result);
		expect(result.exitCode).toBe(1);
		expect(output).toContain("Current version:");
		expect(output).toContain("Detected channel: unknown");
		expect(output).toContain("Update blocked");
		expect(output).not.toContain("Model Provider URL");
	});

	it("ignores a PATH shadow and never replaces it", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-update-command-"));
		const fakeBinary = path.join(tempDir, "xcsh");
		try {
			fs.writeFileSync(fakeBinary, "#!/bin/sh\nprintf 'xcsh/0.0.0\\n'\n", { mode: 0o755 });
			const before = fs.readFileSync(fakeBinary);
			const result = runUpdateSubprocess(["--force"], tempDir);
			const { combined: output } = processOutput(result);
			expect(result.exitCode).toBe(1);
			expect(output).toContain("Detected channel: unknown");
			expect(fs.readFileSync(fakeBinary)).toEqual(before);
			expect(output).not.toContain("Model Provider URL");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}, 40_000);

	it("returns usage exit 2 for mixed and invalid forms before fetching or resource output", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-update-rejection-"));
		const fetchMarker = path.join(tempDir, "fetch-called");
		try {
			for (const argv of [["--check", "-f", "test/fixtures/resource-manifest.yaml"], ["-f"], ["--unknown"]]) {
				const result = Bun.spawnSync(
					[process.execPath, "--preload", updateFetchPreload, "src/cli.ts", "update", ...argv],
					{
						cwd: codingAgentDir,
						env: { ...process.env, XCSH_UPDATE_FETCH_MARKER: fetchMarker },
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const { stdout, combined: output } = processOutput(result);
				expect(result.exitCode).toBe(2);
				expect(stdout).not.toContain('"operation":"update"');
				expect(output).not.toContain("Model Provider URL");
				expect(fs.existsSync(fetchMarker)).toBe(false);
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}, 40_000);
});

describe("update-cli install target detection", () => {
	it("directs Homebrew installs to the cask upgrade command", () => {
		expect(getBrewUpgradeCommand()).toBe("brew upgrade --cask f5-sales-demo/tap/xcsh");
	});
});
