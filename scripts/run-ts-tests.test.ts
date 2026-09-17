import { describe, expect, test } from "bun:test";
import { bunTestFlags, MAX_FILE_WORKERS, parseFileWorkers } from "./run-ts-tests";

describe("file-worker contract", () => {
	test("accepts every bounded integer including serial and the cap", () => {
		for (const workers of [0, 1, 10, MAX_FILE_WORKERS]) {
			expect(parseFileWorkers([`--file-workers=${workers}`], {})).toBe(workers);
		}
		expect(bunTestFlags(20)).toEqual(["--only-failures", "--max-concurrency=2", "--parallel=20"]);
	});

	test("rejects invalid values and within-file concurrency", () => {
		for (const value of ["-1", "1.5", "33", "two", "01"]) {
			expect(() => parseFileWorkers([`--file-workers=${value}`], {})).toThrow("integer from 0 through 32");
		}
		expect(() => parseFileWorkers(["--concurrent"], {})).toThrow("--concurrent is not supported");
	});
});
