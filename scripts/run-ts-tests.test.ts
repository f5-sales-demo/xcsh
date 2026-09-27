import { describe, expect, test } from "bun:test";
import { bunTestFlags, MAX_FILE_WORKERS, parseFileWorkers, parseShard, shardTestCommands } from "./run-ts-tests";

describe("file-worker contract", () => {
	test("accepts every bounded integer including serial and the cap", () => {
		for (const workers of [0, 1, 10, MAX_FILE_WORKERS]) {
			expect(parseFileWorkers([`--file-workers=${workers}`], {})).toBe(workers);
		}
		expect(bunTestFlags(20)).toEqual(["--only-failures", "--max-concurrency=2", "--parallel=20"]);
	});

	test("rejects invalid values and within-file concurrency", () => {
		for (const value of ["-1", "1.5", "41", "two", "01"]) {
			expect(() => parseFileWorkers([`--file-workers=${value}`], {})).toThrow("integer from 0 through 40");
		}
		expect(() => parseFileWorkers(["--concurrent"], {})).toThrow("--concurrent is not supported");
	});
});

describe("workspace shard contract", () => {
	test("accepts only the two declared shards", () => {
		expect(parseShard(["--shard=native-independent"])).toBe("native-independent");
		expect(parseShard(["--shard=native-dependent"])).toBe("native-dependent");
		expect(parseShard([])).toBeUndefined();
		expect(() => parseShard(["--shard=other"])).toThrow("unknown TypeScript test shard");
	});

	test("runs each workspace serially with bounded Bun concurrency", () => {
		expect(shardTestCommands(["@f5-sales-demo/pi-ai", "@f5-sales-demo/pi-utils"], 0)).toEqual([
			["bun", "run", "--filter", "@f5-sales-demo/pi-ai", "test", "--", "--only-failures", "--max-concurrency=2"],
			["bun", "run", "--filter", "@f5-sales-demo/pi-utils", "test", "--", "--only-failures", "--max-concurrency=2"],
		]);
	});
});
