import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Guard: the enriched API specs must ship embedded in the binary, and neither the
// deprecated legacy API-docs path nor the abandoned `vesctl` CLI may leak into the
// embedded spec/catalog data. (branding-index.generated.ts legitimately names both
// as deprecations, so it is intentionally NOT scanned here.)

const INTERNAL_URLS_DIR = path.resolve(import.meta.dir, "../src/internal-urls");
const SPEC_INDEX = path.join(INTERNAL_URLS_DIR, "api-spec-index.generated.ts");
const CATALOG_INDEX = path.join(INTERNAL_URLS_DIR, "api-catalog-index.generated.ts");

const FORBIDDEN = ["docs-v2/api", "docs.cloud.f5.com/docs-v2/api", "vesctl"];

describe("embedded enriched API specs", () => {
	it("ships the api-spec index embedded and non-trivial", () => {
		expect(existsSync(SPEC_INDEX)).toBe(true);
		// The embedded OpenAPI payload is tens of MB; guard against an emptied/stub file.
		expect(statSync(SPEC_INDEX).size).toBeGreaterThan(1_000_000);
		const text = readFileSync(SPEC_INDEX, "utf-8");
		expect(text).toContain("export const API_SPEC_DATA");
		expect(text).toContain("export const API_SPEC_INDEX");
		expect(text).toContain("export const API_SPEC_VERSION");
	});

	it("ships the api-catalog index embedded", () => {
		expect(existsSync(CATALOG_INDEX)).toBe(true);
		expect(statSync(CATALOG_INDEX).size).toBeGreaterThan(100_000);
		expect(readFileSync(CATALOG_INDEX, "utf-8")).toContain("export const API_CATALOG_DATA");
	});

	it("contains no deprecated legacy API-docs URL or vesctl references", () => {
		for (const file of [SPEC_INDEX, CATALOG_INDEX]) {
			const text = readFileSync(file, "utf-8");
			for (const needle of FORBIDDEN) {
				expect(text.includes(needle), `${path.basename(file)} must not contain "${needle}"`).toBe(false);
			}
		}
	});
});
