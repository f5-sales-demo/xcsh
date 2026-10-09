import { expect, test } from "bun:test";
import { measureCorpusRequests, validateCorpusMeasurementRequests } from "../src/corpus-measurement";

test("installed corpus measurement restricts reads to offline corpus routes", () => {
	expect(() => validateCorpusMeasurementRequests(["https://example.com/"])).toThrow();
	expect(() => validateCorpusMeasurementRequests(["xcsh://registry/provider/f5-sales-demo/xcsh"])).toThrow();
	expect(() => validateCorpusMeasurementRequests([])).toThrow();
	expect(
		validateCorpusMeasurementRequests([
			"xcsh://documentation/",
			"xcsh://terraform-documentation/",
			"xcsh://api-spec/sites",
			"xcsh://api-catalog/",
		]),
	).toHaveLength(4);
});
test("installed corpus measurement verifies five responses including removed-content errors", async () => {
	let calls = 0;
	const results = await measureCorpusRequests(["xcsh://documentation/missing/index.md"], async () => {
		calls++;
		throw new Error("Document not found");
	});
	expect(calls).toBe(5);
	expect(results[0]!.error).toBe("Document not found");
	expect(results[0]!.times_ms).toHaveLength(5);
	await expect(
		measureCorpusRequests(["xcsh://api-spec/sites"], async () => ({ content: String(Math.random()) })),
	).rejects.toThrow("Non-deterministic");
});
