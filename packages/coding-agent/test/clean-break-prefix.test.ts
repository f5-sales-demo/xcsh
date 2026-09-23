import { describe, expect, it } from "bun:test";

describe("environment prefix clean break", () => {
	it("contains no tracked references to the discontinued prefix", () => {
		const discontinued = ["F5", "XC_"].join("");
		const result = Bun.spawnSync(["git", "grep", "-n", "--fixed-strings", discontinued], {
			cwd: new URL("../../..", import.meta.url).pathname,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode).toBe(1);
		expect(result.stdout.toString()).toBe("");
	});
});
