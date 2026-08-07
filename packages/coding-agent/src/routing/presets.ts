import type { RoutingPoolConfig } from "./types";

export const BUILTIN_ROUTING_PRESETS: Record<string, RoutingPoolConfig> = {
	"openai/gpt-5.6": {
		id: "openai/gpt-5.6",
		provider: "openai",
		tiers: {
			utility: "gpt-4o-mini",
			balanced: "gpt-4o",
			frontier: "o3-mini",
		},
	},
	"anthropic/claude": {
		id: "anthropic/claude",
		provider: "anthropic",
		tiers: {
			utility: "claude-3-5-haiku-latest",
			balanced: "claude-3-5-sonnet-latest",
			frontier: "claude-3-opus-latest",
		},
	},
	"litellm/openai": {
		id: "litellm/openai",
		provider: "litellm",
		tiers: {
			utility: "gpt-5.6-luna",
			balanced: "gpt-5.6-terra",
			frontier: "gpt-5.6-sol",
		},
	},
	"litellm/anthropic": {
		id: "litellm/anthropic",
		provider: "litellm",
		tiers: {
			utility: "claude-3-5-haiku-latest",
			balanced: "claude-3-5-sonnet-latest",
			frontier: "claude-3-opus-latest",
		},
	},
};

/**
 * Resolve active pool for an anchor model string (e.g. "openai/gpt-4o" or "litellm/gpt-5.6-terra").
 * Custom overrides take precedence over built-in presets.
 * Returns undefined if model/provider is untiered or unknown.
 */
export function resolveModelPool(
	anchorModel: string,
	customPools: Record<string, RoutingPoolConfig> = {},
): RoutingPoolConfig | undefined {
	// 1. Extract provider and model name
	let provider = "";
	let modelName = anchorModel;
	if (anchorModel.includes("/")) {
		const parts = anchorModel.split("/");
		provider = parts[0];
		modelName = parts.slice(1).join("/");
	}

	// 2. Check custom pools first
	for (const [_poolId, pool] of Object.entries(customPools)) {
		if (!pool?.tiers) continue;
		if (provider && pool.provider && pool.provider !== provider && pool.id !== anchorModel) {
			continue;
		}

		if (
			pool.id === anchorModel ||
			pool.tiers.utility === anchorModel ||
			pool.tiers.balanced === anchorModel ||
			pool.tiers.frontier === anchorModel ||
			pool.tiers.utility === modelName ||
			pool.tiers.balanced === modelName ||
			pool.tiers.frontier === modelName ||
			`${pool.provider ?? provider}/${pool.tiers.utility}` === anchorModel ||
			`${pool.provider ?? provider}/${pool.tiers.balanced}` === anchorModel ||
			`${pool.provider ?? provider}/${pool.tiers.frontier}` === anchorModel
		) {
			return pool;
		}
	}

	// 3. Match against built-in presets (enforcing provider prefix match if present)
	for (const [presetId, pool] of Object.entries(BUILTIN_ROUTING_PRESETS)) {
		if (provider && pool.provider && pool.provider !== provider && presetId !== anchorModel) {
			continue; // Provider mismatch!
		}

		if (
			presetId === anchorModel ||
			pool.tiers.utility === modelName ||
			pool.tiers.balanced === modelName ||
			pool.tiers.frontier === modelName ||
			`${pool.provider}/${pool.tiers.utility}` === anchorModel ||
			`${pool.provider}/${pool.tiers.balanced}` === anchorModel ||
			`${pool.provider}/${pool.tiers.frontier}` === anchorModel
		) {
			return pool;
		}
	}

	// No match - untiered or unknown model
	return undefined;
}
