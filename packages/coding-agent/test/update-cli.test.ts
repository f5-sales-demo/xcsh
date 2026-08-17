import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderCommandHelp } from "@f5-sales-demo/pi-utils/cli";
import { _resolveUpdateMethodForTest, parseUpdateArgs } from "../src/cli/update-cli";
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

			expect(compatibilityUpdate).toContain("Update the xcsh executable or existing resources from manifests");
			expect(compatibilityUpdate).toContain("-f, --filename=<value>");
			expect(compatibilityUpdate).toContain("--force");
			expect(compatibilityUpdate).toContain("xcsh self-update -f");
			expect(executableUpdate).toContain("Check for and install xcsh executable updates");
			expect(executableUpdate).toContain("--check");
		} finally {
			write.mockRestore();
		}
	});

	it("directs both English update notices to the version-universal command", () => {
		const mainSource = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
		const messages = JSON.parse(
			fs.readFileSync(new URL("../src/locales/en.json", import.meta.url), "utf8"),
		) as Record<string, string>;

		expect(mainSource).toContain("run: xcsh update");
		expect(mainSource).not.toContain("run: xcsh self-update");
		expect(messages["welcome.updateHint"]).toBe("run: xcsh update");
	});

	it.each([
		["bare", []],
		["check", ["--check"]],
		["short check", ["-c"]],
	])("runs the %s executable form without entering onboarding", (_name, argv) => {
		const result = runUpdateSubprocess(argv);
		const { combined: output } = processOutput(result);
		expect(result.exitCode).toBe(0);
		expect(output).toContain("Current version:");
		expect(output).toContain("Already up to date");
		expect(output).not.toContain("Model Provider URL");
	});

	it("runs update --force through executable replacement without entering onboarding", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-update-command-"));
		const fakeBinary = path.join(tempDir, "xcsh");
		try {
			fs.writeFileSync(fakeBinary, "#!/bin/sh\nprintf 'xcsh/0.0.0\\n'\n", { mode: 0o755 });
			const result = runUpdateSubprocess(["--force"], tempDir);
			const { combined: output } = processOutput(result);
			expect(result.exitCode).toBe(0);
			expect(output).toContain("Forcing reinstall");
			expect(output).toContain("Install method: binary");
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
	// --- Existing tests (bun and binary) ---

	it("uses bun update when prioritized xcsh is inside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/example/.bun/bin/xcsh", "/Users/example/.bun/bin");

		expect(method).toBe("bun");
	});

	it("uses binary update when prioritized xcsh is outside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/example/.local/bin/xcsh", "/Users/example/.bun/bin");

		expect(method).toBe("binary");
	});

	it("uses binary update when bun global bin cannot be resolved", () => {
		const method = _resolveUpdateMethodForTest("/Users/example/.local/bin/xcsh", undefined);

		expect(method).toBe("binary");
	});

	// --- Brew detection (path-based) ---

	it("uses brew update when path contains Cellar", () => {
		const method = _resolveUpdateMethodForTest("/opt/homebrew/Cellar/xcsh/15.5.0/bin/xcsh", undefined);

		expect(method).toBe("brew");
	});

	it("uses brew update when path contains homebrew", () => {
		const method = _resolveUpdateMethodForTest("/opt/homebrew/bin/xcsh", undefined);

		expect(method).toBe("brew");
	});

	it("prefers bun over brew when binary is in bun global bin under homebrew", () => {
		const method = _resolveUpdateMethodForTest("/opt/homebrew/.bun/bin/xcsh", "/opt/homebrew/.bun/bin");

		expect(method).toBe("bun");
	});

	// --- npm detection (symlink-based) ---

	describe("npm detection via symlinks", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-update-test-"));
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("uses npm update when binary is a symlink into node_modules", () => {
			// Create a fake node_modules structure
			const nodeModulesTarget = path.join(tmpDir, "node_modules", "@f5-sales-demo", "xcsh", "dist");
			fs.mkdirSync(nodeModulesTarget, { recursive: true });
			const targetFile = path.join(nodeModulesTarget, "xcsh");
			fs.writeFileSync(targetFile, "");

			// Create a symlink pointing into node_modules
			const symlink = path.join(tmpDir, "xcsh");
			fs.symlinkSync(path.join("node_modules", "@f5-sales-demo", "xcsh", "dist", "xcsh"), symlink);

			const method = _resolveUpdateMethodForTest(symlink, undefined);

			expect(method).toBe("npm");
		});

		it("uses npm update for chained symlinks resolving into node_modules", () => {
			// Create node_modules target
			const nodeModulesTarget = path.join(tmpDir, "lib", "node_modules", "@f5-sales-demo", "xcsh", "dist");
			fs.mkdirSync(nodeModulesTarget, { recursive: true });
			const targetFile = path.join(nodeModulesTarget, "xcsh");
			fs.writeFileSync(targetFile, "");

			// First symlink: usr/bin/xcsh -> lib/node_modules/.../xcsh
			const binDir = path.join(tmpDir, "usr", "bin");
			fs.mkdirSync(binDir, { recursive: true });
			const firstLink = path.join(binDir, "xcsh");
			fs.symlinkSync(path.join(tmpDir, "lib", "node_modules", "@f5-sales-demo", "xcsh", "dist", "xcsh"), firstLink);

			// Second symlink: local/bin/xcsh -> usr/bin/xcsh
			const localBinDir = path.join(tmpDir, "local", "bin");
			fs.mkdirSync(localBinDir, { recursive: true });
			const secondLink = path.join(localBinDir, "xcsh");
			fs.symlinkSync(firstLink, secondLink);

			const method = _resolveUpdateMethodForTest(secondLink, undefined);

			expect(method).toBe("npm");
		});
	});
});
