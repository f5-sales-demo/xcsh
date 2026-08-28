import { describe, expect, it } from "bun:test";
import * as path from "node:path";

const RELEASE_BUILD = path.resolve(import.meta.dir, "../../../../scripts/ci-release-build-binaries.ts");

describe("release console catalog guard", () => {
	it("rejects a generated catalog with no embedded workflows", async () => {
		const source = await Bun.file(RELEASE_BUILD).text();

		expect(source).toContain("CONSOLE_CATALOG_DATA");
		expect(source).toContain("Object.keys(generatedCatalog.CONSOLE_CATALOG_DATA?.workflows ?? {}).length");
		expect(source).toMatch(/console catalog.*no workflows/i);
	});
});
