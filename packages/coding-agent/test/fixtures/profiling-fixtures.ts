import type { RoutingReasonCode, RoutingTier } from "../../src/routing/types";

export interface ProfilingFixture {
	id: string;
	description: string;
	prompt: string;
	contextEstimate?: {
		usedTokens: number;
		contextWindow: number;
	};
	hasImages?: boolean;
	priorRejection?: boolean;
	expectedScoreMin: number;
	expectedScoreMax: number;
	expectedTier: RoutingTier;
	expectedReasons: RoutingReasonCode[];
}

export const PROFILING_FIXTURES: ProfilingFixture[] = [
	{
		id: "simple_read",
		description: "Single-file simple read or summary",
		prompt: "Summarize the contents of README.md",
		expectedScoreMin: 0,
		expectedScoreMax: 30,
		expectedTier: "utility",
		expectedReasons: ["simple_operation"],
	},
	{
		id: "mechanical_edit",
		description: "Single file simple typo fix",
		prompt: "Fix typo in line 5 of package.json",
		expectedScoreMin: 0,
		expectedScoreMax: 30,
		expectedTier: "utility",
		expectedReasons: ["simple_operation"],
	},
	{
		id: "balanced_feature",
		description: "Standard feature implementation or debugging across 1-2 files",
		prompt: "Add a new helper method to format dates in utils/date-formatter.ts and update its unit test",
		expectedScoreMin: 31,
		expectedScoreMax: 69,
		expectedTier: "balanced",
		expectedReasons: [],
	},
	{
		id: "architecture_migration",
		description: "Complex architecture design, migration or security review",
		prompt:
			"Refactor the session state storage to support multi-region database migration and perform security analysis",
		expectedScoreMin: 70,
		expectedScoreMax: 100,
		expectedTier: "frontier",
		expectedReasons: ["complex_intent"],
	},
	{
		id: "prior_rejection_escalation",
		description: "Prompt after a prior validated test rejection",
		prompt: "Fix the failing authentication test",
		priorRejection: true,
		expectedScoreMin: 55,
		expectedScoreMax: 100,
		expectedTier: "frontier",
		expectedReasons: ["prior_rejection"],
	},
	{
		id: "multimodal_image",
		description: "Task requiring image analysis",
		prompt: "Inspect this screenshot image and describe the UI layout",
		hasImages: true,
		expectedScoreMin: 40,
		expectedScoreMax: 100,
		expectedTier: "balanced",
		expectedReasons: ["special_capability_required"],
	},
	{
		id: "high_context_watermark",
		description: "Large context window usage > 80%",
		prompt: "Continue refactoring based on current chat session",
		contextEstimate: {
			usedTokens: 170000,
			contextWindow: 200000,
		},
		expectedScoreMin: 50,
		expectedScoreMax: 100,
		expectedTier: "balanced",
		expectedReasons: ["context_high_watermark"],
	},
];
