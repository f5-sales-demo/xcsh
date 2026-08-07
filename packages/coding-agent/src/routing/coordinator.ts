import { classifyTaskHybrid } from "./classifier";
import { resolveModelPool } from "./presets";
import { resolveTierModel } from "./resolver";
import { type RoutingState, RoutingStateMachine } from "./state-machine";
import type { RoutingDecision, RoutingMode, RoutingPoolConfig, RoutingReasonCode } from "./types";

export interface CoordinatorOptions {
	stateMachine?: RoutingStateMachine;
}

export interface EvaluateTurnOptions {
	anchorModel: string;
	mode: RoutingMode;
	prompt: string;
	contextEstimate?: {
		usedTokens: number;
		contextWindow: number;
	};
	hasImages?: boolean;
	priorRejection?: boolean;
	fileTargetsCount?: number;
	availableModels: string[];
	customPools?: Record<string, RoutingPoolConfig>;
	profilerMode?: "rules" | "hybrid";
	downshiftAfterTurns?: number;
	mockClassifierRunner?: (utilityModel: string, prompt: string) => Promise<string>;
}

export class RoutingCoordinator {
	private stateMachine: RoutingStateMachine;

	constructor(options?: CoordinatorOptions) {
		this.stateMachine = options?.stateMachine ?? new RoutingStateMachine();
	}

	public getStateMachine(): RoutingStateMachine {
		return this.stateMachine;
	}

	public getState(): RoutingState {
		return this.stateMachine.getState();
	}

	public restoreState(state: Partial<RoutingState>): void {
		this.stateMachine.restoreState(state);
	}

	public async evaluateTurn(options: EvaluateTurnOptions): Promise<RoutingDecision> {
		const epochId = `route-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const state = this.stateMachine.getState();

		// 1. Manual pin check
		if (state.manualPin) {
			return {
				epochId,
				mode: options.mode,
				anchorModel: options.anchorModel,
				selectedModel: state.manualPin,
				applied: false,
				reasons: ["user_model_pin"],
			};
		}

		// 2. Mode off check
		if (options.mode === "off") {
			return {
				epochId,
				mode: "off",
				anchorModel: options.anchorModel,
				selectedModel: options.anchorModel,
				applied: false,
				reasons: ["mode_off"],
			};
		}

		// 3. Pool lookup
		const pool = resolveModelPool(options.anchorModel, options.customPools ?? {});
		if (!pool) {
			return {
				epochId,
				mode: options.mode,
				anchorModel: options.anchorModel,
				selectedModel: options.anchorModel,
				applied: false,
				reasons: ["provider_untiered"],
			};
		}

		// 4. Task profiling
		const taskProfile = await classifyTaskHybrid({
			prompt: options.prompt,
			contextEstimate: options.contextEstimate,
			hasImages: options.hasImages,
			priorRejection: options.priorRejection,
			fileTargetsCount: options.fileTargetsCount,
			pool,
			profilerMode: options.profilerMode ?? "hybrid",
			mockClassifierRunner: options.mockClassifierRunner,
		});

		// 5. State machine hysteresis & floor (evaluate on clone in shadow mode to prevent active state mutation)
		const isShadow = options.mode === "shadow";
		const targetSm = isShadow ? new RoutingStateMachine(this.stateMachine.getState()) : this.stateMachine;
		const { effectiveTier } = targetSm.evaluateNextTurn(taskProfile.desiredTier, options.downshiftAfterTurns ?? 2);

		// 6. Resolve pool tier model
		const resolved = resolveTierModel(pool, effectiveTier, options.availableModels);
		if (resolved.degraded || !resolved.selectedModel) {
			return {
				epochId,
				mode: options.mode,
				poolId: pool.id,
				anchorModel: options.anchorModel,
				desiredTier: taskProfile.desiredTier,
				effectiveTier,
				selectedModel: options.anchorModel,
				applied: false,
				reasons: [...taskProfile.reasons, "pool_single_tier"],
			};
		}

		const applied = !isShadow;
		const reasons: RoutingReasonCode[] = [...taskProfile.reasons];
		if (isShadow) {
			reasons.push("mode_shadow");
		}

		return {
			epochId,
			mode: options.mode,
			poolId: pool.id,
			anchorModel: options.anchorModel,
			desiredTier: taskProfile.desiredTier,
			effectiveTier: resolved.effectiveTier,
			selectedModel: resolved.selectedModel,
			source: options.profilerMode === "rules" ? "rules" : "hybrid",
			applied,
			reasons,
		};
	}
}
