/**
 * Interactive vLLM connection setup.
 *
 * vLLM exposes an OpenAI-compatible HTTP API and may be local, remote,
 * authenticated, or unauthenticated. This module only collects and validates
 * connection values; the coding-agent owns probing and persistence.
 */

import type { OAuthController } from "./types";

export const DEFAULT_VLLM_BASE_URL = "http://127.0.0.1:8000/v1";

export interface VllmLoginDefaults {
	baseUrl?: string;
	apiKey?: string;
}

export interface VllmLoginResult {
	baseUrl: string;
	apiKey: string;
}

export interface VllmLoginOptions extends OAuthController {
	defaults?: VllmLoginDefaults;
}

export function normalizeVllmBaseUrl(value: string): string {
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("vLLM Base URL must be a valid HTTP or HTTPS URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("vLLM Base URL must use HTTP or HTTPS");
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error("vLLM Base URL must not contain credentials, query parameters, or a fragment");
	}
	return parsed.toString().replace(/\/+$/, "");
}

export async function loginVllm(options: VllmLoginOptions): Promise<VllmLoginResult> {
	if (!options.onPrompt) {
		throw new Error("vLLM login requires onPrompt callback");
	}
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const defaultBaseUrl = options.defaults?.baseUrl ?? DEFAULT_VLLM_BASE_URL;
	const rawBaseUrl = await options.onPrompt({
		message: "vLLM Base URL",
		placeholder: DEFAULT_VLLM_BASE_URL,
		initialValue: defaultBaseUrl,
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	const baseUrl = normalizeVllmBaseUrl(rawBaseUrl.trim() || defaultBaseUrl);

	const defaultApiKey = options.defaults?.apiKey ?? "";
	const rawApiKey = await options.onPrompt({
		message: "vLLM API Key (optional; leave blank for no authentication)",
		placeholder: "Optional bearer token",
		allowEmpty: true,
		initialValue: defaultApiKey,
		masked: true,
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	return {
		baseUrl,
		apiKey: rawApiKey.trim(),
	};
}
