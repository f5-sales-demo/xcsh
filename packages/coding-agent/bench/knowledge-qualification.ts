export interface HybridQualificationInput {
	readonly exactNoRegression: boolean;
	readonly apiRecallAt1Gain: number;
	readonly apiMrrGain: number;
	readonly documentationNdcgAt5Gain: number;
	readonly documentationMrrGain: number;
	readonly classifierPrecision: number;
	readonly classifierRecall: number;
	readonly sealedNoMatchFalsePositives: number;
	readonly compressedBytes: number;
	readonly warmRetrievalP95Ms: number;
	readonly endToEndBaselineMedianMs: number;
	readonly endToEndCandidateMedianMs: number;
	readonly endToEndBaselineP95Ms: number;
	readonly endToEndCandidateP95Ms: number;
	readonly reranker?: {
		readonly metricGain: number;
		readonly correctionTurnReduction: number;
		readonly warmRetrievalP95Ms: number;
	};
}

export interface HybridQualificationResult {
	readonly vectorQualifies: boolean;
	readonly rerankerQualifies: boolean;
	readonly failedVectorGates: readonly string[];
	readonly failedRerankerGates: readonly string[];
}

export function evaluateHybridQualification(input: HybridQualificationInput): HybridQualificationResult {
	const vectorGates = {
		"exact-query-no-regression": input.exactNoRegression,
		"api-recall-at-1-gain": input.apiRecallAt1Gain >= 0.1,
		"api-mrr-gain": input.apiMrrGain >= 0.08,
		"documentation-ndcg-at-5-gain": input.documentationNdcgAt5Gain >= 0.05,
		"documentation-mrr-gain": input.documentationMrrGain >= 0.05,
		"classifier-precision": input.classifierPrecision >= 0.99,
		"classifier-recall": input.classifierRecall >= 0.95,
		"classifier-no-match": input.sealedNoMatchFalsePositives === 0,
		"compressed-vector-payload": input.compressedBytes <= 250 * 1024 * 1024,
		"warm-vector-p95": input.warmRetrievalP95Ms < 250,
		"end-to-end-median": input.endToEndCandidateMedianMs <= input.endToEndBaselineMedianMs,
		"end-to-end-p95": input.endToEndCandidateP95Ms <= input.endToEndBaselineP95Ms * 1.05,
	};
	const failedVectorGates = Object.entries(vectorGates)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
	const rerankerGates = {
		"vector-candidate": failedVectorGates.length === 0,
		"incremental-quality": (input.reranker?.metricGain ?? Number.NEGATIVE_INFINITY) >= 0.05,
		"correction-turn-reduction": (input.reranker?.correctionTurnReduction ?? Number.NEGATIVE_INFINITY) >= 0.1,
		"warm-reranker-p95": (input.reranker?.warmRetrievalP95Ms ?? Number.POSITIVE_INFINITY) < 750,
	};
	const failedRerankerGates = Object.entries(rerankerGates)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
	return {
		vectorQualifies: failedVectorGates.length === 0,
		rerankerQualifies: failedRerankerGates.length === 0,
		failedVectorGates,
		failedRerankerGates,
	};
}
