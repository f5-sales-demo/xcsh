/** Value-free workflow events derived from executed tools and the tenant transport. */
export type ContextFlowEvent =
	| { kind: "selection"; context: string; outcome: "connected" | "auth_error" | "failed" }
	| { kind: "query"; context: string; credentialMatches: boolean };

/** Score causal execution, independently of whether the final prose sounds convincing. */
export function scoreContextFlow(
	events: readonly ContextFlowEvent[],
	requestedContext: string,
	expectation: "query" | "blocked" | "clarification",
) {
	let connected = false;
	let selectionAttempted = false;
	let prematureQueries = 0;
	let wrongTargetQueries = 0;
	let substitutedSelections = 0;
	let queries = 0;
	for (const event of events) {
		if (event.kind === "selection") {
			selectionAttempted = true;
			if (event.context !== requestedContext) substitutedSelections++;
			connected = event.context === requestedContext && event.outcome === "connected";
		} else {
			queries++;
			if (!connected) prematureQueries++;
			if (event.context !== requestedContext || !event.credentialMatches) wrongTargetQueries++;
		}
	}
	return {
		passed:
			substitutedSelections === 0 &&
			prematureQueries === 0 &&
			wrongTargetQueries === 0 &&
			(expectation === "blocked"
				? selectionAttempted && !connected && queries === 0
				: connected && (expectation === "clarification" || queries > 0)),
		selectionAttempted,
		queries,
		prematureQueries,
		wrongTargetQueries,
		substitutedSelections,
	};
}
