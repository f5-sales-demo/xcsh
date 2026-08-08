import type { RoutingMode, RoutingReasonCode, RoutingTier } from "./types";

export interface RoutingEvent {
	type: "routing_decision" | "routing_applied" | "routing_delegated" | "routing_escalated" | "routing_skipped";
	epochId: string;
	mode?: RoutingMode;
	provider?: string;
	poolId?: string;
	effectiveTier?: RoutingTier;
	selectedModel?: string;
	reasons: RoutingReasonCode[];
	timestamp?: number;
	routingUsage?: number;
	delegated?: boolean;
	escalated?: boolean;
	contextTokens?: number;
	durationMs?: number;
}

export function sanitizeRoutingEvent(event: Record<string, unknown>): RoutingEvent {
	const allowedKeys = new Set([
		"type",
		"epochId",
		"mode",
		"provider",
		"poolId",
		"effectiveTier",
		"selectedModel",
		"reasons",
		"timestamp",
		"routingUsage",
		"delegated",
		"escalated",
		"contextTokens",
		"durationMs",
	]);

	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(event)) {
		if (allowedKeys.has(key)) {
			sanitized[key] = value;
		}
	}

	return {
		type: (sanitized.type as RoutingEvent["type"]) ?? "routing_decision",
		epochId: (sanitized.epochId as string) ?? "unknown",
		mode: sanitized.mode as RoutingMode | undefined,
		provider: sanitized.provider as string | undefined,
		poolId: sanitized.poolId as string | undefined,
		effectiveTier: sanitized.effectiveTier as RoutingTier | undefined,
		selectedModel: (sanitized.selectedModel as string | undefined) ?? (event.model as string | undefined),
		reasons: (sanitized.reasons as RoutingReasonCode[]) ?? [],
		timestamp: (sanitized.timestamp as number) ?? Date.now(),
		routingUsage: sanitized.routingUsage as number | undefined,
		delegated: sanitized.delegated as boolean | undefined,
		escalated: sanitized.escalated as boolean | undefined,
		contextTokens: sanitized.contextTokens as number | undefined,
		durationMs: sanitized.durationMs as number | undefined,
	};
}

export function createRoutingDecisionEvent(params: {
	epochId: string;
	mode: RoutingMode;
	provider?: string;
	poolId?: string;
	effectiveTier?: RoutingTier;
	selectedModel?: string;
	reasons: RoutingReasonCode[];
}): RoutingEvent {
	return sanitizeRoutingEvent({
		type: "routing_decision",
		...params,
		timestamp: Date.now(),
	});
}
