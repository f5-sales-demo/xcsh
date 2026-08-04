import { describe, expect, it } from "bun:test";
import * as path from "node:path";

const SUPER_LINTER_WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/super-linter.yml");

describe("Super-Linter workflow", () => {
	it("pins the edition-aware governance workflow for Rust 2024", async () => {
		const source = await Bun.file(SUPER_LINTER_WORKFLOW).text();

		expect(source).toContain(
			"uses: f5-sales-demo/docs-control/.github/workflows/super-linter.yml@d75d315e83d9947b658f8e86b21654512fd437f6",
		);
		expect(source).toContain('rust_edition: "2024"');
	});
});
