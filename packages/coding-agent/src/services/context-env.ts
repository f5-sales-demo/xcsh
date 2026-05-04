import { SECRET_ENV_PATTERNS } from "../secrets/index";
import { F5XC_API_TOKEN, F5XC_API_URL, F5XC_NAMESPACE, F5XC_TENANT } from "./f5xc-env";

/** Keys excluded from the system prompt context variables listing. */
const PROMPT_HIDDEN = new Set([F5XC_API_TOKEN, F5XC_API_URL, F5XC_TENANT, F5XC_NAMESPACE]);

/** Keys never expanded in payloads — credentials that must not leak into request bodies. */
const PAYLOAD_HIDDEN = new Set([F5XC_API_TOKEN, F5XC_API_URL]);

export interface ContextEnv {
	/** Get a single env var value from bash.environment, or undefined. */
	get(key: string): string | undefined;

	/**
	 * Resolve `{placeholder}` values in a URL path.
	 * Explicit params are applied first. Remaining `{key}` placeholders are
	 * resolved from bash.environment: `{namespace}` → F5XC_NAMESPACE,
	 * `{key}` → F5XC_{KEY.toUpperCase()}.
	 * Unresolvable placeholders are left intact.
	 */
	resolvePath(path: string, explicitParams?: Record<string, string>): string;

	/**
	 * Expand `$F5XC_*` variable references in a serialized JSON payload string.
	 * Unresolvable references are left intact.
	 */
	resolvePayloadVars(payloadJson: string): string;

	/**
	 * Return non-sensitive F5XC_* env vars from bash.environment, suitable for
	 * display in the LLM system prompt. Excludes ALWAYS_HIDDEN keys, keys
	 * matching SECRET_ENV_PATTERNS, and explicitly provided sensitiveKeys.
	 */
	getNonSensitiveVars(): Record<string, string>;
}

export interface ContextEnvOptions {
	/** Additional keys to treat as sensitive (e.g. from context.sensitiveKeys). */
	sensitiveKeys?: ReadonlySet<string>;
}

/**
 * Create a ContextEnv instance bound to the current bash.environment settings.
 *
 * @param settings - Any object with a `get(key)` method returning the value of
 *   "bash.environment" as `Record<string, string>`. Pass `Settings.instance` or
 *   `session.settings` in production; pass a stub in tests.
 * @param options - Optional configuration (sensitiveKeys to exclude).
 */
export function createContextEnv(settings: { get(key: string): unknown }, options?: ContextEnvOptions): ContextEnv {
	function bashEnv(): Record<string, string> {
		return (settings.get("bash.environment") ?? {}) as Record<string, string>;
	}

	function allSensitiveKeys(): ReadonlySet<string> {
		if (options?.sensitiveKeys) return options.sensitiveKeys;
		const fromSettings = settings.get("f5xc.sensitiveKeys");
		return new Set(Array.isArray(fromSettings) ? (fromSettings as string[]) : []);
	}

	return {
		get(key: string): string | undefined {
			return bashEnv()[key];
		},

		resolvePath(path: string, explicitParams?: Record<string, string>): string {
			let resolved = path;

			// Apply explicit params first
			if (explicitParams) {
				for (const [key, value] of Object.entries(explicitParams)) {
					resolved = resolved.replaceAll(`{${key}}`, value);
				}
			}

			// Auto-resolve remaining {placeholder} values from bash.environment
			const env = bashEnv();
			const sensitive = allSensitiveKeys();
			resolved = resolved.replace(/\{(\w+)\}/g, (match, key) => {
				// {namespace} maps directly to F5XC_NAMESPACE
				const envKey = key === "namespace" ? F5XC_NAMESPACE : `F5XC_${key.toUpperCase()}`;
				// Never auto-inject credential or sensitive values into URL paths
				if (PAYLOAD_HIDDEN.has(envKey)) return match;
				if (SECRET_ENV_PATTERNS.test(envKey)) return match;
				if (sensitive.has(envKey)) return match;
				return env[envKey] ?? match;
			});

			return resolved;
		},

		resolvePayloadVars(payloadJson: string): string {
			const env = bashEnv();
			const sensitive = allSensitiveKeys();
			return payloadJson.replace(/\$F5XC_([A-Z0-9_]+)/g, (match, suffix) => {
				const key = `F5XC_${suffix}`;
				// Never expand credential keys into payloads
				if (PAYLOAD_HIDDEN.has(key)) return match;
				if (SECRET_ENV_PATTERNS.test(key)) return match;
				if (sensitive.has(key)) return match;
				const value = env[key];
				if (value === undefined) return match;
				// JSON-escape the substituted value to prevent injection
				return JSON.stringify(value).slice(1, -1);
			});
		},

		getNonSensitiveVars(): Record<string, string> {
			const env = bashEnv();
			const sensitive = allSensitiveKeys();
			const result: Record<string, string> = {};
			for (const [key, value] of Object.entries(env)) {
				if (!key.startsWith("F5XC_")) continue;
				if (PROMPT_HIDDEN.has(key)) continue;
				if (SECRET_ENV_PATTERNS.test(key)) continue;
				if (sensitive.has(key)) continue;
				result[key] = value;
			}
			return result;
		},
	};
}
