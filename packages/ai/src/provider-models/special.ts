import type { ModelManagerOptions } from "../model-manager";
import { discoverKiroModels, kiroCacheNamespace } from "../providers/kiro-service";
import { fetchCodexModels } from "../utils/discovery/codex";
import { fetchCursorUsableModels } from "../utils/discovery/cursor";
import type { KiroCredentials } from "../utils/oauth/kiro-credentials";

// ---------------------------------------------------------------------------
// OpenAI Codex
// ---------------------------------------------------------------------------

export interface OpenAICodexModelManagerConfig {
	accessToken?: string;
	accountId?: string;
	clientVersion?: string;
}

export function openaiCodexModelManagerOptions(
	config: OpenAICodexModelManagerConfig = {},
): ModelManagerOptions<"openai-codex-responses"> {
	const { accessToken, accountId, clientVersion } = config;
	return {
		providerId: "openai-codex",
		staticModels: [],
		...(accessToken
			? {
					fetchDynamicModels: async signal => {
						const result = await fetchCodexModels({ accessToken, accountId, clientVersion, signal });
						return result?.models ?? null;
					},
				}
			: undefined),
	};
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface CursorModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
	clientVersion?: string;
}

export function cursorModelManagerOptions(config: CursorModelManagerConfig = {}): ModelManagerOptions<"cursor-agent"> {
	const { apiKey, baseUrl, clientVersion } = config;
	return {
		providerId: "cursor",
		...(apiKey
			? {
					fetchDynamicModels: () => fetchCursorUsableModels({ apiKey, baseUrl, clientVersion }),
				}
			: undefined),
	};
}

// ---------------------------------------------------------------------------
// Amazon Bedrock
// ---------------------------------------------------------------------------

// Dynamic discovery requires AWS SDK auth (ListFoundationModels). Not yet implemented.

export interface AmazonBedrockModelManagerConfig {}

export function amazonBedrockModelManagerOptions(
	_config: AmazonBedrockModelManagerConfig = {},
): ModelManagerOptions<"bedrock-converse-stream"> {
	return { providerId: "amazon-bedrock" };
}

// ---------------------------------------------------------------------------
// MiniMax variants (subscription-based, no model listing endpoint)
// ---------------------------------------------------------------------------

export interface MinimaxModelManagerConfig {}

export function minimaxModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "minimax" };
}

export function minimaxCnModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "minimax-cn" };
}

export function minimaxCodeModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"openai-completions"> {
	return { providerId: "minimax-code" };
}

export function minimaxCodeCnModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"openai-completions"> {
	return { providerId: "minimax-code-cn" };
}

// ---------------------------------------------------------------------------
// Zai
// ---------------------------------------------------------------------------

export interface ZaiModelManagerConfig {}

export function zaiModelManagerOptions(_config: ZaiModelManagerConfig = {}): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "zai" };
}

/** Kiro catalogs are private to the selected native account and profile. */
export function kiroModelManagerOptions(config: { apiKey: string }): ModelManagerOptions<"kiro-api"> {
	const credentials = JSON.parse(config.apiKey) as KiroCredentials;
	return {
		providerId: "kiro",
		cacheNamespace: kiroCacheNamespace(credentials),
		staticModels: [],
		fetchDynamicModels: async signal => (await discoverKiroModels(credentials, { signal })).models,
	};
}
