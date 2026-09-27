import { describe, expect, it } from "bun:test";
import { evaluateDocumentationQualification } from "./documentation-retrieval-benchmark";

describe("offline documentation retrieval qualification", () => {
	it("requires relevance, integrity, latency, and memory gates", () => {
		const passing = evaluateDocumentationQualification({
			candidateMilliseconds: [10, 11, 12, 13, 14],
			baselineMilliseconds: [20, 21, 22, 23, 24],
			memoryRatios: [0.1, 0.2],
			relevancePassed: true,
			integrityPassed: true,
			apiRegressionPassed: true,
		});
		expect(passing.qualifies).toBe(true);
		expect(passing.medianImprovementRatio).toBeGreaterThanOrEqual(0.2);

		for (const failure of [
			{ relevancePassed: false },
			{ integrityPassed: false },
			{ apiRegressionPassed: false },
			{ candidateMilliseconds: [19, 20, 21, 22, 23] },
			{ candidateMilliseconds: [10, 11, 12, 13, 30] },
			{ memoryRatios: [0.8] },
		]) {
			const result = evaluateDocumentationQualification({
				candidateMilliseconds: [10, 11, 12, 13, 14],
				baselineMilliseconds: [20, 21, 22, 23, 24],
				memoryRatios: [0.1, 0.2],
				relevancePassed: true,
				integrityPassed: true,
				apiRegressionPassed: true,
				...failure,
			});
			expect(result.qualifies).toBe(false);
		}
	});
});
