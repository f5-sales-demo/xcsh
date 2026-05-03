import { describe, expect, it } from "bun:test";

describe("api-spec-index.generated.ts — uncompressed storage", () => {
	it("exports API_SPEC_DATA as plain objects, not base64 strings", async () => {
		const mod = await import("../../src/internal-urls/api-spec-index.generated");
		expect(mod.API_SPEC_DATA).toBeDefined();
		expect(typeof mod.API_SPEC_DATA).toBe("object");

		const firstKey = Object.keys(mod.API_SPEC_DATA)[0];
		expect(firstKey).toBeDefined();

		const firstValue = mod.API_SPEC_DATA[firstKey!];
		expect(typeof firstValue).toBe("object");
		expect(firstValue).toHaveProperty("paths");
	});

	it("does NOT export API_SPEC_BLOBS", async () => {
		const mod = await import("../../src/internal-urls/api-spec-index.generated");
		expect((mod as Record<string, unknown>).API_SPEC_BLOBS).toBeUndefined();
	});
});
