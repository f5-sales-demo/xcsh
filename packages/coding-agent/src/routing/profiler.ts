import type { RoutingReasonCode, RoutingTier, TaskProfile } from "./types";

export interface ProfilerInput {
	prompt: string;
	contextEstimate?: {
		usedTokens: number;
		contextWindow: number;
	};
	hasImages?: boolean;
	priorRejection?: boolean;
}

const COMPLEX_KEYWORDS = [
	"architecture",
	"migration",
	"security",
	"security review",
	"audit",
	"refactor the session",
	"multi-region",
	"system design",
	"ambiguity",
	"target",
];

const SIMPLE_READ_PATTERNS = [/^(summarize|read|cat|view|explain)\b/i, /\bfix typo\b/i, /\btypo in line\b/i];

export function profileTaskDeterministic(input: ProfilerInput): TaskProfile {
	const reasons: RoutingReasonCode[] = [];
	let score = 30; // base score (default balanced)

	const promptLower = input.prompt.toLowerCase().trim();

	// Check simple operation (-20)
	const isSimple = SIMPLE_READ_PATTERNS.some(pat => pat.test(promptLower));
	if (isSimple && !input.priorRejection) {
		score -= 20;
		reasons.push("simple_operation");
	}

	// Prior rejection (+25)
	if (input.priorRejection) {
		score += 25;
		reasons.push("prior_rejection");
	}

	// Complex intent (+20 per matched complex area)
	let complexMatches = 0;
	for (const kw of COMPLEX_KEYWORDS) {
		if (promptLower.includes(kw)) {
			complexMatches++;
		}
	}
	if (complexMatches > 0) {
		score += Math.min(40, complexMatches * 20);
		reasons.push("complex_intent");
	}

	// Special capability / images (+10)
	if (input.hasImages) {
		score += 10;
		reasons.push("special_capability_required");
	}

	// Context high watermark (+10 for >= 60%, +20 for >= 80%)
	if (input.contextEstimate && input.contextEstimate.contextWindow > 0) {
		const ratio = input.contextEstimate.usedTokens / input.contextEstimate.contextWindow;
		if (ratio >= 0.8) {
			score += 20;
			reasons.push("context_high_watermark");
		} else if (ratio >= 0.6) {
			score += 10;
			reasons.push("context_high_watermark");
		}
	}

	// Multi-target mutation (+15)
	if (promptLower.includes("across multiple")) {
		score += 15;
		reasons.push("multi_target_mutation");
	}

	// Clamp to 0..100
	score = Math.max(0, Math.min(100, score));

	let desiredTier: RoutingTier = "balanced";
	if (score <= 30) {
		desiredTier = "utility";
	} else if (score >= 70) {
		desiredTier = "frontier";
	}

	if (input.hasImages && desiredTier === "utility") {
		desiredTier = "balanced";
	}
	if (input.priorRejection) {
		desiredTier = "frontier";
	}

	return {
		complexityScore: score,
		desiredTier,
		confidence: 0.9,
		reasons,
		requiredCapabilities: {
			vision: !!input.hasImages,
			tools: true,
			minimumContextTokens: input.contextEstimate?.usedTokens ?? 0,
		},
	};
}
