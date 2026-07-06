/**
 * Pure TTFT span-frame builders for Phase 2. The worker emits these over the bridge
 * WS; the extension records them (proc:'xcsh') and summarizeTtft stitches them into
 * the init->first-token timeline. Chrome-free, so they unit-test in isolation.
 */
export interface SpanFrame {
	type: "span";
	stage: string;
	ms: number;
	id?: string;
	sid?: string;
	cold?: boolean;
}

const clamp = (ms: number): number => (ms > 0 ? ms : 0);

/**
 * Decompose one chat turn's route->first-token into two disjoint spans that sum to
 * (firstDeltaAt - entryAt): provider_ttft (prompt issued -> first token) and
 * chat_handler (the xcsh routing/compose/emit overhead = entry -> prompt issued).
 */
export function chatSpans(id: string, entryAt: number, promptAt: number, firstDeltaAt: number): SpanFrame[] {
	const providerMs = clamp(firstDeltaAt - promptAt);
	const handlerMs = clamp(firstDeltaAt - entryAt - providerMs);
	return [
		{ type: "span", stage: "provider_ttft", ms: providerMs, id },
		{ type: "span", stage: "chat_handler", ms: handlerMs, id },
	];
}

/** Build the per-session cold-start spans, tagged with the session id + authoritative cold. */
export function coldStartSpans(
	sid: string,
	cold: boolean,
	managerProvisionMs: number,
	workerBootMs: number,
): SpanFrame[] {
	return [
		{ type: "span", stage: "manager_provision", ms: clamp(managerProvisionMs), sid, cold },
		{ type: "span", stage: "worker_boot", ms: clamp(workerBootMs), sid, cold },
	];
}
