export interface ContextEligibilityOptions {
	estimatedInputTokens: number;
	reserveTokens?: number;
	candidateContextWindow: number;
}

export function checkCandidateContextEligible(options: ContextEligibilityOptions): boolean {
	const { estimatedInputTokens, reserveTokens = 0, candidateContextWindow } = options;
	if (candidateContextWindow <= 0) return true;

	const fifteenPercentReserve = Math.floor(candidateContextWindow * 0.15);
	const effectiveReserve = Math.max(reserveTokens, fifteenPercentReserve);

	return estimatedInputTokens + effectiveReserve < candidateContextWindow;
}
