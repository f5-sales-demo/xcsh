import { describe, expect, it } from "bun:test";
import * as path from "node:path";

const SUPER_LINTER_WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/super-linter.yml");
const GOVERNED_SUPER_LINTER_CALLER =
	/^\s+uses: f5-sales-demo\/docs-control\/\.github\/workflows\/super-linter\.yml@[0-9a-f]{40}$/m;

describe("Super-Linter workflow", () => {
	it("pins the edition-aware governance workflow for Rust 2024", async () => {
		const source = await Bun.file(SUPER_LINTER_WORKFLOW).text();

		expect(source).toMatch(GOVERNED_SUPER_LINTER_CALLER);
		expect(source).toContain('rust_edition: "2024"');
	});
});
