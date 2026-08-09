import { type ProfilerInput, profileTaskDeterministic } from "./profiler";
import type { RoutingPoolConfig, RoutingTier, TaskProfile } from "./types";

export interface HybridClassifierOptions extends ProfilerInput {
	pool?: RoutingPoolConfig;
	profilerMode?: "rules" | "hybrid";
	runRoutingClassifier?: (utilityModel: string, prompt: string) => Promise<string>;
}

export async function classifyTaskHybrid(options: HybridClassifierOptions): Promise<TaskProfile> {
	const baseProfile = profileTaskDeterministic(options);

	// 1. If rules mode, or profile is clear (utility <=30 or frontier >=70), return baseProfile immediately without classifier call
	if (
		options.profilerMode === "rules" ||
		baseProfile.complexityScore <= 30 ||
		baseProfile.complexityScore >= 70 ||
		!options.pool
	) {
		return baseProfile;
	}

	// 2. Hybrid mode and ambiguous profile (31..69) -> call utility model via runner
	const runner =
		options.runRoutingClassifier ??
		(async (_utilityModel: string, _prompt: string) => {
			return JSON.stringify({ complexityScore: 50, confidence: 0.8 });
		});

	try {
		let utilityModel = options.pool.tiers.utility;
		if (!utilityModel.includes("/") && options.pool.provider) {
			utilityModel = `${options.pool.provider}/${utilityModel}`;
		}
		const rawOutput = await runner(utilityModel, options.prompt);

		const parsed = JSON.parse(rawOutput);
		const score = typeof parsed.complexityScore === "number" ? parsed.complexityScore : 40;
		const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
		const delegation =
			typeof parsed.delegation === "object" && parsed.delegation !== null && !Array.isArray(parsed.delegation)
				? parsed.delegation
				: undefined;
		const routingUsage = typeof parsed.routingUsage === "number" ? parsed.routingUsage : undefined;

		if (confidence < 0.75) {
			return { ...baseProfile, routingUsage };
		}

		let desiredTier: RoutingTier = "balanced";
		if (score <= 30) {
			desiredTier = "utility";
		} else if (score >= 70) {
			desiredTier = "frontier";
		}

		if (options.hasImages && desiredTier === "utility") {
			desiredTier = "balanced";
		}
		if (options.priorRejection) {
			desiredTier = "frontier";
		}

		return {
			...baseProfile,
			complexityScore: score,
			desiredTier,
			confidence,
			delegation,
			routingUsage,
			reasons: [...baseProfile.reasons, "classifier_ambiguous_resolved"],
		};
	} catch (err: unknown) {
		if (err instanceof Error && err.name === "AbortError") {
			throw err;
		}
		const isSyntax = err instanceof SyntaxError || (err instanceof Error && err.message.includes("malformed"));
		return {
			...baseProfile,
			reasons: [...baseProfile.reasons, isSyntax ? "classifier_fallback_malformed" : "classifier_fallback_timeout"],
		};
	}
}
