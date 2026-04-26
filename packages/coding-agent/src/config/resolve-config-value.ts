/**
 * Resolve configuration values that may be shell commands, environment variables, or literals.
 *
 * Note: command execution is async to avoid blocking the TUI.
 */

import { executeShell } from "@f5xc-salesdemos/pi-natives";

/**
 * Matches strings that look like environment variable names: ALL_CAPS_WITH_UNDERSCORES.
 * Used to prevent sending literal env var names (e.g. "LITELLM_API_KEY") as Bearer
 * tokens when the env var is unset. Same pattern as resolveYamlApiKeyConfig in
 * model-registry.ts.
 */
const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/;

/** Cache for successful shell command results (persists for process lifetime). */
const commandResultCache = new Map<string, string>();

/** De-duplicates concurrent executions for the same command. */
const commandInFlight = new Map<string, Promise<string | undefined>>();

/**
 * Resolve a config value (API key, header value, etc.) to an actual value.
 * - If starts with "!", executes the rest as a shell command and uses stdout (cached)
 * - Otherwise checks environment variable first
 * - If the env var is unset and the config string looks like an env var name
 *   (ALL_CAPS_WITH_UNDERSCORES), returns undefined to prevent leaking literal
 *   names as Bearer tokens (see issue #241)
 * - Otherwise treats the config string as a literal value
 */
export async function resolveConfigValue(config: string): Promise<string | undefined> {
	if (config.startsWith("!")) {
		return await executeCommand(config);
	}
	const envValue = process.env[config];
	if (envValue) return envValue;
	// Reject unresolved env var names to prevent sending literal names as API keys.
	// Actual literal API keys (sk-ant-..., UUIDs, etc.) won't match this pattern.
	if (ENV_VAR_NAME_RE.test(config)) return undefined;
	return config;
}

async function executeCommand(commandConfig: string): Promise<string | undefined> {
	const cached = commandResultCache.get(commandConfig);
	if (cached !== undefined) {
		return cached;
	}

	const existing = commandInFlight.get(commandConfig);
	if (existing) {
		return await existing;
	}

	const command = commandConfig.slice(1);
	const promise = runShellCommand(command, 10_000)
		.then(result => {
			if (result !== undefined) {
				commandResultCache.set(commandConfig, result);
			}
			return result;
		})
		.finally(() => {
			commandInFlight.delete(commandConfig);
		});

	commandInFlight.set(commandConfig, promise);
	return await promise;
}

async function runShellCommand(command: string, timeoutMs: number): Promise<string | undefined> {
	try {
		let output = "";
		const result = await executeShell({ command, timeoutMs }, (err, chunk) => {
			if (!err) {
				output += chunk;
			}
		});
		if (result.timedOut || result.exitCode !== 0) {
			return undefined;
		}
		const trimmed = output.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolve all header values using the same resolution logic as API keys.
 */
export async function resolveHeaders(
	headers: Record<string, string> | undefined,
): Promise<Record<string, string> | undefined> {
	if (!headers) return undefined;
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const resolvedValue = await resolveConfigValue(value);
		if (resolvedValue) {
			resolved[key] = resolvedValue;
		}
	}
	return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/** Clear the config value command cache. Exported for testing. */
export function clearConfigValueCache(): void {
	commandResultCache.clear();
	commandInFlight.clear();
}
