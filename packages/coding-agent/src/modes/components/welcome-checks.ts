import type { Model } from "@f5xc-salesdemos/pi-ai";
import { validateApiKeyAgainstModelsEndpoint } from "@f5xc-salesdemos/pi-ai/utils/oauth/api-key-validation";
import { logger } from "@f5xc-salesdemos/pi-utils";
import { type AuthStatus, ContextService } from "../../services/f5xc-context";
import { deriveTenantFromUrl } from "../../services/f5xc-env";
import type { AuthStorage } from "../../session/auth-storage";

// Startup validation budget. These are longer than validateToken's 3000ms default because
// the welcome path runs during TLS/DNS cold-start — a single 3s shot races against warm-up
// and falsely reports offline for contexts that reconnect cleanly moments later.
const STARTUP_FIRST_TIMEOUT_MS = 4000;
const STARTUP_RETRY_TIMEOUT_MS = 5000;
const STARTUP_RETRY_DELAY_MS = 500;

type ContextValidator = (opts: {
	timeoutMs: number;
}) => Promise<{ status: AuthStatus; latencyMs?: number; errorClass?: "network" | "credential" | "url_not_found" }>;

/**
 * Runs the context validator once with a startup-sized timeout; if the result is `offline`
 * (the only transient class — auth_error/connected/unknown are definitive), waits briefly
 * to let DNS/TLS warm up, then tries once more with a longer timeout.
 */
export async function validateContextWithStartupRetry(
	validate: ContextValidator,
	options?: {
		firstTimeoutMs?: number;
		retryTimeoutMs?: number;
		retryDelayMs?: number;
	},
): Promise<{ status: AuthStatus; latencyMs?: number; errorClass?: "network" | "credential" | "url_not_found" }> {
	const firstTimeoutMs = options?.firstTimeoutMs ?? STARTUP_FIRST_TIMEOUT_MS;
	const retryTimeoutMs = options?.retryTimeoutMs ?? STARTUP_RETRY_TIMEOUT_MS;
	const retryDelayMs = options?.retryDelayMs ?? STARTUP_RETRY_DELAY_MS;

	const first = await validate({ timeoutMs: firstTimeoutMs });
	if (first.status !== "offline") return first;

	if (retryDelayMs > 0) {
		await new Promise(resolve => setTimeout(resolve, retryDelayMs));
	}
	return await validate({ timeoutMs: retryTimeoutMs });
}

export type ModelCheckState = "no_provider" | "connected" | "auth_error";

export interface ModelStatus {
	state: ModelCheckState;
	provider?: string;
	latencyMs?: number;
}

export type ContextCheckState = "no_context" | "connected" | "auth_error" | "offline";

export interface WelcomeContextStatus {
	state: ContextCheckState;
	name?: string;
	latencyMs?: number;
	errorClass?: "network" | "credential" | "url_not_found";
}

export interface WelcomeCheckResult {
	model: ModelStatus;
	context?: WelcomeContextStatus;
}

/** Providers that don't store API keys (local inference servers) */
const KEYLESS_PROVIDERS = new Set(["ollama", "llama.cpp", "lm-studio", "llamafile", "local"]);

/**
 * Run blocking startup checks for the welcome screen.
 * Model check always runs. Context check only runs if model is connected.
 */
export async function runWelcomeChecks(
	model: Model | undefined,
	authStorage: AuthStorage,
): Promise<WelcomeCheckResult> {
	const provider = model?.provider ?? "unknown";

	// Step 1: Check model provider credentials exist
	// Keyless local providers (ollama, llama.cpp, lm-studio, etc.) don't store credentials
	if (!authStorage.hasAuth(provider) && !KEYLESS_PROVIDERS.has(provider)) {
		return { model: { state: "no_provider", provider } };
	}

	// Step 2: Live model validation — try to reach the models endpoint
	const modelStatus = await validateModelConnection(model, authStorage);
	if (modelStatus.state !== "connected") {
		return { model: modelStatus };
	}

	// Step 3: Context check (only if model is connected)
	const contextStatus = await checkContextStatus();
	return { model: modelStatus, context: contextStatus };
}

async function validateModelConnection(model: Model | undefined, authStorage: AuthStorage): Promise<ModelStatus> {
	const provider = model?.provider ?? "unknown";
	try {
		const rawApiKey = await authStorage.peekApiKey(provider);
		if (!rawApiKey) {
			// Keyless providers skip validation
			if (KEYLESS_PROVIDERS.has(provider)) {
				return { state: "connected", provider, latencyMs: 0 };
			}
			return { state: "auth_error", provider };
		}

		// Detect unresolved env var names (e.g. "LITELLM_API_KEY" sent as literal)
		if (/^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/.test(rawApiKey)) {
			return { state: "auth_error", provider };
		}

		const baseUrl = model?.baseUrl;
		if (!baseUrl) {
			return { state: "auth_error", provider };
		}

		// GitHub Copilot returns a structured JSON token {token, enterpriseUrl};
		// extract the actual token for API validation
		let apiKey = rawApiKey;
		if (provider === "github-copilot" && rawApiKey.startsWith("{")) {
			try {
				const parsed = JSON.parse(rawApiKey);
				apiKey = parsed.token ?? rawApiKey;
			} catch {
				// Not JSON — use as-is
			}
		}

		const modelsUrl = `${baseUrl}/models`;
		const start = performance.now();
		await validateApiKeyAgainstModelsEndpoint({
			provider,
			apiKey,
			modelsUrl,
		});
		const latencyMs = Math.round(performance.now() - start);
		return { state: "connected", provider, latencyMs };
	} catch {
		logger.warn("Welcome model validation failed");
		return { state: "auth_error", provider };
	}
}

async function checkContextStatus(): Promise<WelcomeContextStatus> {
	try {
		const contextService = ContextService.instance;
		if (!contextService) {
			return { state: "no_context" };
		}

		const status = contextService.getStatus();
		if (!status.isConfigured) {
			return { state: "no_context" };
		}

		const name =
			status.activeContextName ??
			(status.credentialSource === "environment" && status.activeContextUrl
				? (deriveTenantFromUrl(status.activeContextUrl) ?? "(environment)")
				: undefined);
		const result = await validateContextWithStartupRetry(opts => contextService.validateToken(opts));

		switch (result.status) {
			case "connected":
				return { state: "connected", name, latencyMs: result.latencyMs };
			case "auth_error":
				return { state: "auth_error", name };
			case "offline":
				return { state: "offline", name, errorClass: result.errorClass };
			default:
				return { state: "no_context" };
		}
	} catch {
		logger.warn("Welcome context validation failed");
		return { state: "no_context" };
	}
}
