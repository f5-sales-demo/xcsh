import type { ProfileCollection } from "../person-profile/service";

export type IntegrationState = "ready" | "setup_required" | "unavailable" | "degraded" | "rate_limited" | "error";

export type IntegrationReason =
	| "cli_missing"
	| "not_authenticated"
	| "expired"
	| "permission_denied"
	| "dependency_missing"
	| "network"
	| "rate_limited"
	| "invalid_response";

export interface IntegrationProbeResult<T> {
	readonly state: IntegrationState;
	readonly reason?: IntegrationReason;
	readonly value?: T;
	/** Provider supplied cooldown. It is never persisted as provider response data. */
	readonly retryAfterMs?: number;
}

export interface IntegrationSetupStep {
	readonly kind: "install" | "login";
	readonly argv: readonly string[];
	readonly timeoutMs: number;
	/** Environment variable names inherited by this step. Values are never part of the plan. */
	readonly environment?: readonly string[];
	readonly stdin?: "inherit";
}

export interface IntegrationVerificationStep {
	readonly argv: readonly string[];
	readonly timeoutMs: number;
}

export interface IntegrationGuidedSetupAction {
	readonly kind: "context_wizard";
}

export interface IntegrationSetupPlan {
	readonly pluginDependencies: readonly string[];
	readonly requiredEnvironment: readonly string[];
	readonly profileFields: readonly string[];
	readonly steps: readonly IntegrationSetupStep[];
	readonly verification: readonly IntegrationVerificationStep[];
	readonly guidedAction?: IntegrationGuidedSetupAction;
}

export interface IntegrationDefinition<T> {
	readonly id: string;
	readonly name: string;
	readonly plugin?: string;
	readonly kind: "local" | "network" | "on_demand";
	readonly dependencies?: readonly string[];
	readonly successTtlMs?: number;
	readonly setup?: IntegrationSetupPlan;
	readonly probe: (signal?: AbortSignal) => Promise<IntegrationProbeResult<T>>;
	/** Optional private profile projection. The registry never persists `value` itself. */
	readonly profile?: (value: T) => ProfileCollection;
}

export interface IntegrationSnapshot<T = unknown> {
	readonly id: string;
	readonly name: string;
	readonly plugin?: string;
	readonly state: IntegrationState;
	readonly reason?: IntegrationReason;
	readonly value?: T;
	readonly checkedAt: number;
	readonly retryAt?: number;
	readonly durationMs: number;
}

export interface IntegrationHandle<T> {
	readonly id: string;
	readonly name: string;
	readonly plugin?: string;
	readonly setupPlan?: IntegrationSetupPlan;
	get(signal?: AbortSignal): Promise<IntegrationSnapshot<T>>;
	invalidate(): void;
	verifyAfterSetup(reviewedPlan: IntegrationSetupPlan, signal?: AbortSignal): Promise<IntegrationSnapshot<T>>;
}

export interface IntegrationStatus {
	readonly id: string;
	readonly name: string;
	readonly plugin?: string;
	readonly state: IntegrationState;
	readonly reason?: IntegrationReason;
	readonly checkedAt: number;
	readonly retryAt?: number;
	readonly durationMs: number;
}
