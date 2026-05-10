import { SECRET_ENV_PATTERNS } from "../secrets/index";
import { F5XC_API_TOKEN, F5XC_API_URL, F5XC_CONTEXT_NAME, F5XC_NAMESPACE, F5XC_TENANT } from "./f5xc-env";

/** Keys excluded from the system prompt context variables listing. */
const PROMPT_HIDDEN: ReadonlySet<string> = new Set([
	F5XC_API_TOKEN,
	F5XC_API_URL,
	F5XC_TENANT,
	F5XC_NAMESPACE,
	F5XC_CONTEXT_NAME,
]);
/** Keys never expanded in payloads — credentials that must not leak into request bodies. */
const PAYLOAD_HIDDEN: ReadonlySet<string> = new Set([F5XC_API_TOKEN, F5XC_API_URL]);

export interface ContextEnv {
	get(key: string): string | undefined;
	/** Resolve {placeholder} values in a URL path. Explicit params first, then auto-resolve from bash.environment. */
	resolvePath(path: string, explicitParams?: Record<string, string>): string;
	/** Expand $F5XC_* variable references in a serialized JSON payload string. */
	resolvePayloadVars(payloadJson: string): string;
	/** Return non-sensitive F5XC_* env vars from bash.environment for system prompt display. */
	getNonSensitiveVars(): Record<string, string>;
	getContextName(): string | undefined;
}

export type ContextEnvOptions = { sensitiveKeys?: ReadonlySet<string> };

function isSensitiveKey(key: string, hidden: ReadonlySet<string>, sensitive: ReadonlySet<string>): boolean {
	return hidden.has(key) || SECRET_ENV_PATTERNS.test(key) || sensitive.has(key);
}
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
		getContextName(): string | undefined {
			return bashEnv()[F5XC_CONTEXT_NAME] || undefined;
		},

		resolvePath(path: string, explicitParams?: Record<string, string>): string {
			let resolved = path;
			// Apply explicit params first — collect substituted ranges to prevent double-substitution
			const substituted = new Set<number>();
			if (explicitParams) {
				for (const [key, value] of Object.entries(explicitParams)) {
					const placeholder = `{${key}}`;
					let idx = resolved.indexOf(placeholder);
					while (idx !== -1) {
						resolved = resolved.slice(0, idx) + value + resolved.slice(idx + placeholder.length);
						for (let i = idx; i < idx + value.length; i++) substituted.add(i);
						idx = resolved.indexOf(placeholder, idx + value.length);
					}
				}
			}
			// Auto-resolve remaining {placeholder} values from bash.environment
			const env = bashEnv();
			const sensitive = allSensitiveKeys();
			resolved = resolved.replace(/\{(\w+)\}/g, (match, key, offset: number) => {
				// Skip placeholders that fall within a previously substituted range
				if (substituted.has(offset)) return match;
				// {namespace} maps directly to F5XC_NAMESPACE
				const envKey = key === "namespace" ? F5XC_NAMESPACE : `F5XC_${key.toUpperCase()}`;
				// Never auto-inject credential or sensitive values into URL paths
				if (isSensitiveKey(envKey, PAYLOAD_HIDDEN, sensitive)) return match;
				return env[envKey] ?? process.env[envKey] ?? match;
			});
			return resolved;
		},

		resolvePayloadVars(payloadJson: string): string {
			const env = bashEnv();
			const sensitive = allSensitiveKeys();
			// $F5XC_* matches without word boundary — intentional for payload values
			return payloadJson.replace(/\$F5XC_([A-Z0-9_]+)/g, (match, suffix) => {
				const key = `F5XC_${suffix}`;
				// Never expand credential keys into payloads
				if (isSensitiveKey(key, PAYLOAD_HIDDEN, sensitive)) return match;
				const value = env[key] ?? process.env[key];
				if (value === undefined) return match;
				// JSON-escape the substituted value to prevent injection
				return JSON.stringify(value).slice(1, -1);
			});
		},

		getNonSensitiveVars(): Record<string, string> {
			const sensitive = allSensitiveKeys();
			return Object.fromEntries(
				Object.entries(bashEnv()).filter(
					([key]) => key.startsWith("F5XC_") && !isSensitiveKey(key, PROMPT_HIDDEN, sensitive),
				),
			);
		},
	};
}
