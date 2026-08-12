export type RoutingTier = "utility" | "balanced" | "frontier";
export type RoutingMode = "off" | "shadow" | "auto";
export type RoutingDecisionSource = "rules" | "classifier" | "hybrid";

export type RoutingReasonCode =
	| "default_initial_tier"
	| "user_model_pin"
	| "provider_untiered"
	| "pool_not_found"
	| "pool_single_tier"
	| "mode_off"
	| "mode_shadow"
	| "prior_rejection"
	| "complex_intent"
	| "multi_target_mutation"
	| "special_capability_required"
	| "context_high_watermark"
	| "ambiguous_intent"
	| "simple_operation"
	| "classifier_ambiguous_resolved"
	| "classifier_fallback_timeout"
	| "classifier_fallback_error"
	| "classifier_fallback_malformed"
	| "test_failure"
	| "build_failure"
	| "lint_failure"
	| "context_capacity_promotion"
	| "downshift_hysteresis_pending"
	| "escalation_floor_active"
	| "retry_fallback";

export interface ReadOnlyDelegationSubtask {
	id: string;
	title: string;
	description: string;
	targetFilesOrPaths: string[];
	desiredTier?: RoutingTier;
}

export interface ReadOnlyDelegationPlan {
	reason: string;
	subtasks: ReadOnlyDelegationSubtask[];
}

export interface TaskProfile {
	complexityScore: number; // 0–100
	desiredTier: RoutingTier;
	confidence: number;
	reasons: RoutingReasonCode[];
	requiredCapabilities: {
		vision: boolean;
		tools: boolean;
		minimumContextTokens: number;
	};
	delegation?: ReadOnlyDelegationPlan;
	routingUsage?: number;
}

export interface RoutingPoolTiers {
	utility: string;
	balanced: string;
	frontier: string;
}

export type RoutingEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type RoutingEffortReason = "tier_default" | "complexity_escalation" | "rejection_escalation";

export interface RoutingEffortPolicy {
	byTier: Partial<Record<RoutingTier, RoutingEffort>>;
	frontierEscalation?: {
		effort: RoutingEffort;
		minimumComplexityScore: number;
	};
}

export interface RoutingPoolConfig {
	id: string;
	provider?: string;
	allowMixed?: boolean;
	tiers: RoutingPoolTiers;
	effortPolicy?: RoutingEffortPolicy;
}

export interface RoutingDecision {
	epochId: string;
	mode: RoutingMode;
	poolId?: string;
	anchorModel: string;
	desiredTier?: RoutingTier;
	effectiveTier?: RoutingTier;
	selectedModel?: string;
	selectedEffort?: RoutingEffort;
	effortReason?: RoutingEffortReason;
	source?: RoutingDecisionSource;
	applied: boolean;
	reasons: RoutingReasonCode[];
	delegation?: ReadOnlyDelegationPlan;
	routingUsage?: number;
}

export interface RoutingOutcomeEvidence {
	kind: "test_failure" | "build_failure" | "lint_failure" | "user_feedback" | "retry_fallback";
	summary: string;
}

export interface RoutingOutcome {
	epochId?: string;
	status: "accepted" | "rejected";
	evidence: RoutingOutcomeEvidence[];
	safeToContinue?: boolean;
}

export interface RoutingSettings {
	mode: RoutingMode;
	profiler: "rules" | "hybrid";
	familyPolicy: "sticky" | "configured-mixed";
	delegation: "off" | "read-only";
	delegationMaxTasks: number;
	downshiftAfterTurns: number;

	pools: Record<string, RoutingPoolConfig>;
	disabledPresets: string[];
	tierEffort?: Record<string, string>;

	internalOpenAiUrl?: string;
	internalAnthropicUrl?: string;
}
