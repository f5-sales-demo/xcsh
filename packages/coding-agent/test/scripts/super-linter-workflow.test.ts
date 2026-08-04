import { describe, expect, it } from "bun:test";
import * as path from "node:path";

const SUPER_LINTER_WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/super-linter.yml");
const IMMUTABLE_GOVERNED_SUPER_LINTER =
	/^\s*uses: f5-sales-demo\/docs-control\/\.github\/workflows\/super-linter\.yml@[0-9a-f]{40}\s*$/m;

function hasImmutableGovernedSuperLinter(source: string): boolean {
	return IMMUTABLE_GOVERNED_SUPER_LINTER.test(source);
}

describe("Super-Linter workflow", () => {
	it("pins the canonical governance workflow immutably", async () => {
		const source = await Bun.file(SUPER_LINTER_WORKFLOW).text();

		expect(hasImmutableGovernedSuperLinter(source)).toBe(true);
	});

	it("accepts pin rolls while rejecting mutable or noncanonical references", () => {
		const fullSha = "0".repeat(40);
		expect(
			hasImmutableGovernedSuperLinter(
				`uses: f5-sales-demo/docs-control/.github/workflows/super-linter.yml@${fullSha}`,
			),
		).toBe(true);

		const invalidCallers = [
			"uses: f5-sales-demo/docs-control/.github/workflows/super-linter.yml@main",
			"uses: f5-sales-demo/docs-control/.github/workflows/super-linter.yml@a334c5f",
			`uses: example/docs-control/.github/workflows/super-linter.yml@${fullSha}`,
			`uses: f5-sales-demo/docs-control/.github/workflows/super-linter.yaml@${fullSha}`,
		];

		for (const caller of invalidCallers) {
			expect(hasImmutableGovernedSuperLinter(caller)).toBe(false);
		}
	});
});
