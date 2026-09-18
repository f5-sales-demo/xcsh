import { describe, expect, it } from "bun:test";
import fs from "node:fs";

describe("guarded TypeScript test runner", () => {
	it("serial-fences external-process and live-discovery test files", () => {
		const source = fs.readFileSync(new URL("../../scripts/bun-test-guarded.ts", import.meta.url), "utf8");
		for (const file of [
			"test/remote-control/command.test.ts",
			"test/update-cli.test.ts",
			"test/remote-control/supervisor-process.test.ts",
			"test/model-selector-registry-integration.test.ts",
			"test/interactive-mode-plan-review.test.ts",
		])
			expect(source).toContain(file);
	});
});
