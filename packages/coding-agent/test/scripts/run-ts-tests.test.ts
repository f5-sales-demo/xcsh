import { describe, expect, it } from "bun:test";
import { parseFileWorkers, testCommand, verifiedNativeTestCommands } from "../../../../scripts/run-ts-tests";

describe("guarded TypeScript test runner", () => {
	it("defaults to bounded serial file execution", () => {
		expect(parseFileWorkers([], {})).toBe(0);
		expect(testCommand(0)).toEqual([
			"bun",
			"run",
			"--workspaces",
			"--if-present",
			"test",
			"--",
			"--only-failures",
			"--max-concurrency=2",
		]);
	});

	it("allows exactly two AKS file workers", () => {
		expect(parseFileWorkers(["--file-workers=2"], {})).toBe(2);
		expect(testCommand(2)).toContain("--parallel=2");
	});

	it("rejects every other worker count", () => {
		for (const value of ["1", "3", "4", "unbounded"]) {
			expect(() => parseFileWorkers([], { XCSH_TEST_FILE_WORKERS: value })).toThrow("0 or 2");
		}
	});

	it("never requests Bun's unbounded file scheduling mode", () => {
		expect(testCommand(0).join(" ")).not.toContain("--concurrent");
		expect(testCommand(2).join(" ")).not.toContain("--concurrent");
	});

	it("reuses a verified native package without invoking its build script", () => {
		const commands = verifiedNativeTestCommands(0);
		expect(commands[0]).toContain("!@f5-sales-demo/pi-natives");
		expect(commands[1]).toEqual([
			"bun",
			"test",
			"--cwd",
			"packages/natives",
			"--only-failures",
			"--max-concurrency=2",
		]);
		expect(commands.flat().join(" ")).not.toContain("build");
	});
});
