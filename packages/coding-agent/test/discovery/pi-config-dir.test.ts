import { afterEach, describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import type { LoadContext } from "../../src/capability/types";
import { getConfigDirs } from "../../src/config";
import { getUserPath } from "../../src/discovery/helpers";

describe("PI_CONFIG_DIR", () => {
	const original = process.env.PI_CONFIG_DIR;
	afterEach(() => {
		if (original === undefined) {
			delete process.env.PI_CONFIG_DIR;
		} else {
			process.env.PI_CONFIG_DIR = original;
		}
	});

	test("getUserPath uses PI_CONFIG_DIR for native userAgent", () => {
		process.env.PI_CONFIG_DIR = ".config/xcsh";
		const ctx: LoadContext = {
			cwd: "/work/project",
			home: "/home/example",
			repoRoot: null,
		};

		const result = getUserPath(ctx, "native", "commands");
		expect(result).toBe(path.join(ctx.home, ".config/xcsh/agent", "commands"));
	});

	test("getConfigDirs respects PI_CONFIG_DIR for user base", () => {
		process.env.PI_CONFIG_DIR = ".config/xcsh";
		const result = getConfigDirs("commands", { project: false });
		const expected = path.resolve(path.join(os.homedir(), ".config/xcsh", "agent", "commands"));
		expect(result[0]).toEqual({ path: expected, source: ".xcsh", level: "user" });
	});
});
