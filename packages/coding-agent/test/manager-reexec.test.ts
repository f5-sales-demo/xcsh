import { describe, expect, test } from "bun:test";
import { reexecArgv } from "../src/commands/manager";

describe("reexecArgv", () => {
	test("compiled binary ignores Bun's embedded JavaScript argv path", () => {
		expect(
			reexecArgv(
				"worker",
				["/opt/homebrew/bin/xcsh", "/$bunfs/root/packages/coding-agent/src/cli.js", "manager"],
				"/opt/homebrew/bin/xcsh",
			),
		).toEqual(["worker"]);
	});

	test("development Bun process retains its TypeScript entrypoint", () => {
		expect(
			reexecArgv("worker", ["/opt/homebrew/bin/bun", "/repo/src/cli.ts", "manager"], "/opt/homebrew/bin/bun"),
		).toEqual(["/repo/src/cli.ts", "worker"]);
	});
});
