// Development-only fusion; scores are ranking values, never probabilities.
export function fuseCandidateRoutes(routes: readonly (readonly string[])[], limit = 5) {
	if (!Number.isInteger(limit) || limit < 1) throw new Error("Positive candidate limit required");
	const scores = new Map<string, number>();
	for (const route of routes)
		for (const [rank, uri] of [...new Set(route)].entries())
			scores.set(uri, (scores.get(uri) ?? 0) + 1 / (20 + rank));
	return [...scores]
		.map(([uri, score]) => ({ uri, score: Number(score.toFixed(12)) }))
		.sort((a, b) => b.score - a.score || (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))
		.slice(0, limit);
}
