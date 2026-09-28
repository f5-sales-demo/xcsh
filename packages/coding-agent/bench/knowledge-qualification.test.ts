import { describe, expect, it } from "bun:test";
import { evaluateHybridQualification } from "./knowledge-qualification";

const passing = {
	exactNoRegression: true,
	apiRecallAt1Gain: 0.1,
	apiMrrGain: 0.08,
	documentationNdcgAt5Gain: 0.05,
	documentationMrrGain: 0.05,
	classifierPrecision: 0.99,
	classifierRecall: 0.95,
	sealedNoMatchFalsePositives: 0,
	compressedBytes: 250 * 1024 * 1024,
	warmRetrievalP95Ms: 249,
	endToEndBaselineMedianMs: 1000,
	endToEndCandidateMedianMs: 1000,
	endToEndBaselineP95Ms: 1000,
	endToEndCandidateP95Ms: 1050,
};

describe("hybrid promotion gates", () => {
	it("requires every vector relevance, classifier, footprint, and latency gate", () => {
		expect(evaluateHybridQualification(passing).vectorQualifies).toBe(true);
		for (const failure of [
			{ exactNoRegression: false },
			{ apiRecallAt1Gain: 0.099 },
			{ apiMrrGain: 0.079 },
			{ documentationNdcgAt5Gain: 0.049 },
			{ documentationMrrGain: 0.049 },
			{ classifierPrecision: 0.989 },
			{ classifierRecall: 0.949 },
			{ sealedNoMatchFalsePositives: 1 },
			{ compressedBytes: 250 * 1024 * 1024 + 1 },
			{ warmRetrievalP95Ms: 250 },
			{ endToEndCandidateMedianMs: 1001 },
			{ endToEndCandidateP95Ms: 1051 },
		]) {
			expect(evaluateHybridQualification({ ...passing, ...failure }).vectorQualifies).toBe(false);
		}
	});

	it("ships a reranker only for incremental quality and workflow gains", () => {
		expect(
			evaluateHybridQualification({
				...passing,
				reranker: { metricGain: 0.05, correctionTurnReduction: 0.1, warmRetrievalP95Ms: 749 },
			}).rerankerQualifies,
		).toBe(true);
		expect(
			evaluateHybridQualification({
				...passing,
				reranker: { metricGain: 0.049, correctionTurnReduction: 0.1, warmRetrievalP95Ms: 749 },
			}).rerankerQualifies,
		).toBe(false);
	});
});
