import { describe, expect, it } from "bun:test";

describe("api-catalog-index.generated.ts — uncompressed storage", () => {
	it("exports API_CATALOG_DATA as plain objects, not base64 strings", async () => {
		const mod = await import("../../src/internal-urls/api-catalog-index.generated");
		expect(mod.API_CATALOG_DATA).toBeDefined();
		expect(typeof mod.API_CATALOG_DATA).toBe("object");

		const firstKey = Object.keys(mod.API_CATALOG_DATA)[0];
		expect(firstKey).toBeDefined();

		const firstValue = mod.API_CATALOG_DATA[firstKey!];
		expect(typeof firstValue).toBe("object");
		expect(firstValue).toHaveProperty("displayName");
		expect(firstValue).toHaveProperty("operations");
		expect(Array.isArray(firstValue.operations)).toBe(true);
	});

	it("does NOT export API_CATALOG_BLOBS", async () => {
		const mod = await import("../../src/internal-urls/api-catalog-index.generated");
		expect((mod as Record<string, unknown>).API_CATALOG_BLOBS).toBeUndefined();
	});
});
