import { describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderCommandHelp } from "@f5-sales-demo/pi-utils/cli";
import { getBrewUpgradeCommand } from "../src/cli/update-cli";
import SelfUpdate from "../src/commands/self-update";
import Update, { parseUpdateInvocation } from "../src/commands/update";

const codingAgentDir = import.meta.dir.replace(/\/test$/, "");
const updateFetchPreload = path.join(import.meta.dir, "fixtures", "update-fetch-preload.ts");

function runSelfUpdateSubprocess(args: string[], pathValue?: string): ReturnType<typeof Bun.spawnSync> {
	return Bun.spawnSync([process.execPath, "--preload", updateFetchPreload, "src/cli.ts", "self-update", ...args], {
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
	it("exposes self-update as the sole executable-update command", () => {
		const cliSource = fs.readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
		expect(cliSource).toContain('name: "self-update"');
		expect(fs.existsSync(new URL("../src/commands/self-update.ts", import.meta.url))).toBe(true);
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

	it("reserves update flags for resource manifests", () => {
		expect(() => parseUpdateInvocation(["--check"])).toThrow();
		expect(() => parseUpdateInvocation(["--force"])).toThrow();
		expect(() => parseUpdateInvocation(["-f"])).toThrow();
		expect(() => parseUpdateInvocation(["--unknown"])).toThrow();
		expect(() => parseUpdateInvocation(["manifest.yaml"])).toThrow();
	});

	it("documents separate resource and self-update commands without overlap", () => {
		const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		try {
			renderCommandHelp("xcsh", "update", Update);
			const updateHelp = write.mock.calls.map(([chunk]) => String(chunk)).join("");
			write.mockClear();
			renderCommandHelp("xcsh", "self-update", SelfUpdate);
			const selfUpdateHelp = write.mock.calls.map(([chunk]) => String(chunk)).join("");

			expect(updateHelp).toContain("Update F5 Distributed Cloud resources from manifests");
			expect(updateHelp).toContain("-f, --filename=<value>");
			expect(updateHelp).not.toContain("self-update");
			expect(updateHelp).not.toContain("--force");
			expect(selfUpdateHelp).toContain("Check for xcsh updates and follow the detected installation channel");
			expect(selfUpdateHelp).toContain("--force");
			expect(selfUpdateHelp).toContain("--check");
		} finally {
			write.mockRestore();
		}
	});

	it.each([
		["bare", []],
		["check", ["--check"]],
		["short check", ["-c"]],
	])("fails closed for the %s self-update form in an unproven source checkout", (_name, argv) => {
		const result = runSelfUpdateSubprocess(argv);
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
			const result = runSelfUpdateSubprocess(["--force"], tempDir);
			const { combined: output } = processOutput(result);
			expect(result.exitCode).toBe(1);
			expect(output).toContain("Detected channel: unknown");
			expect(fs.readFileSync(fakeBinary)).toEqual(before);
			expect(output).not.toContain("Model Provider URL");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}, 40_000);

	it("returns usage exit 2 for executable flags passed to the resource command", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-update-rejection-"));
		const fetchMarker = path.join(tempDir, "fetch-called");
		try {
			for (const argv of [["--check"], ["--force"], ["--unknown"]]) {
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
