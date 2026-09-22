import { describe, expect, it } from "bun:test";
import { benchmarkExecutableArgs } from "./model-scenarios";

describe("model scenario executable selection", () => {
	it("uses bun dev by default and an installed binary when explicitly requested", () => {
		expect(benchmarkExecutableArgs()).toEqual([process.execPath, "run", "dev", "--"]);
		expect(benchmarkExecutableArgs("/opt/xcsh/bin/xcsh")).toEqual(["/opt/xcsh/bin/xcsh"]);
	});
});
