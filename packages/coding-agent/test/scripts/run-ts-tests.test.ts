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

	it("allows explicitly qualified AWS file-worker counts", () => {
		for (const workers of [1, 10, 20, 32, 40] as const) {
			expect(parseFileWorkers([`--file-workers=${workers}`], {})).toBe(workers);
			expect(testCommand(workers)).toContain(`--parallel=${workers}`);
		}
	});

	it("rejects values outside the bounded integer range", () => {
		for (const value of ["-1", "41", "1.5", "unbounded"]) {
			expect(() => parseFileWorkers([], { XCSH_TEST_FILE_WORKERS: value })).toThrow("integer from 0 through 40");
		}
	});

	it("never requests Bun's unbounded file scheduling mode", () => {
		expect(testCommand(0).join(" ")).not.toContain("--concurrent");
		for (const workers of [1, 10, 20, 32, 40] as const) {
			expect(testCommand(workers).join(" ")).not.toContain("--concurrent");
		}
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
