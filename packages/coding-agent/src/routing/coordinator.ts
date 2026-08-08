import { classifyTaskHybrid } from "./classifier";
import { resolveModelPool } from "./presets";
import { resolveTierModel } from "./resolver";
import { type RoutingState, RoutingStateMachine } from "./state-machine";
import type { RoutingDecision, RoutingMode, RoutingPoolConfig, RoutingReasonCode, RoutingTier } from "./types";

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
		reserveTokens?: number;
	};
	hasImages?: boolean;
	priorRejection?: boolean;
	availableModels: string[];
	customPools?: Record<string, RoutingPoolConfig>;
	profilerMode?: "rules" | "hybrid";
	disabledPresets?: readonly string[];
	familyPolicy?: "sticky" | "configured-mixed";

	downshiftAfterTurns?: number;
	getModelContextWindow?: (modelId: string) => number;
	runRoutingClassifier?: (utilityModel: string, prompt: string) => Promise<string>;
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

	public reset(): void {
		this.stateMachine.reset();
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
		const pool = resolveModelPool(
			options.anchorModel,
			options.customPools ?? {},
			options.disabledPresets ?? [],
			options.familyPolicy,
		);
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

			pool,
			profilerMode: options.profilerMode ?? "hybrid",
			runRoutingClassifier: options.runRoutingClassifier,
		});

		// Determine anchor model tier
		let anchorTier: RoutingTier = "balanced";
		let modelName = options.anchorModel;
		if (modelName.includes("/")) {
			modelName = modelName.split("/").slice(1).join("/");
		}
		if (
			pool.tiers.utility === options.anchorModel ||
			pool.tiers.utility === modelName ||
			`${pool.provider}/${pool.tiers.utility}` === options.anchorModel
		) {
			anchorTier = "utility";
		} else if (
			pool.tiers.frontier === options.anchorModel ||
			pool.tiers.frontier === modelName ||
			`${pool.provider}/${pool.tiers.frontier}` === options.anchorModel
		) {
			anchorTier = "frontier";
		} else if (
			pool.tiers.balanced === options.anchorModel ||
			pool.tiers.balanced === modelName ||
			`${pool.provider}/${pool.tiers.balanced}` === options.anchorModel
		) {
			anchorTier = "balanced";
		} else if (pool.id === options.anchorModel) {
			anchorTier = "balanced";
		}

		// 5. Speculative state machine evaluation (do NOT mutate operational state until resolution is verified)
		const targetSm = new RoutingStateMachine(this.stateMachine.getState());
		if (targetSm.getState().currentTier === undefined || !targetSm.getState().currentTier) {
			targetSm.restoreState({ currentTier: anchorTier });
		}
		const { effectiveTier } = targetSm.evaluateNextTurn(taskProfile.desiredTier, options.downshiftAfterTurns ?? 2);

		// 6. Resolve pool tier model with context window eligibility
		const resolved = resolveTierModel(pool, effectiveTier, options.availableModels, {
			contextEstimate: options.contextEstimate,
			getModelContextWindow: options.getModelContextWindow,
		});

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

		const isShadow = options.mode === "shadow";
		if (!isShadow) {
			// Commit state machine transition only on successful non-degraded resolution
			this.stateMachine.restoreState(targetSm.getState());
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
			delegation: taskProfile.delegation,
			routingUsage: taskProfile.routingUsage,
		};
	}
}
