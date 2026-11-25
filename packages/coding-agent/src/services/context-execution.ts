import { AsyncLocalStorage } from "node:async_hooks";
import { resolveF5Environment } from "./effective-f5-config";

export interface ContextExecutionSnapshot {
	readonly environment: Readonly<Record<string, string>>;
	readonly sensitiveKeys: readonly string[];
	readonly source: "local" | "global";
	readonly authority: "context" | "environment";
}

const execution = new AsyncLocalStorage<ContextExecutionSnapshot>();
let settingsProvider: (() => Parameters<typeof captureContextExecution>[0] | undefined) | undefined;

/** Settings registers itself; low-level execution must not load the settings runtime. */
export function setContextExecutionSettingsProvider(
	provider: () => Parameters<typeof captureContextExecution>[0] | undefined,
): void {
	settingsProvider = provider;
}

/** Private runtime data only. Never serialize this credential-bearing snapshot. */
export function currentContextExecution(): ContextExecutionSnapshot | undefined {
	return execution.getStore();
}

export function captureContextExecution(settings: {
	get(key: "bash.environment"): unknown;
	get(key: "xcsh.sensitiveKeys"): unknown;
	get(key: "xcsh.contextSource"): unknown;
	get(key: "xcsh.contextAuthority"): unknown;
}): ContextExecutionSnapshot {
	const inherited = execution.getStore();
	if (inherited) return inherited;
	const authority = settings.get("xcsh.contextAuthority") === "context" ? "context" : "environment";
	const environment = resolveF5Environment(
		(settings.get("bash.environment") ?? {}) as Record<string, string>,
		authority,
	);
	return Object.freeze({
		authority,
		source: settings.get("xcsh.contextSource") === "local" ? "local" : "global",
		environment: Object.freeze(environment),
		sensitiveKeys: Object.freeze([...((settings.get("xcsh.sensitiveKeys") as string[]) ?? [])]),
	});
}

export function runWithContextExecution<T>(snapshot: ContextExecutionSnapshot, action: () => T): T {
	return execution.run(snapshot, action);
}

/** Credentials resolve from the admitted turn when present, including absent values. */
export function executionEnvironmentValue(key: string): string | undefined {
	if (execution.getStore()) return execution.getStore()!.environment[key];
	const settings = settingsProvider?.();
	return settings ? captureContextExecution(settings).environment[key] : process.env[key];
}

export function captureNextContextExecution(
	settings: Parameters<typeof captureContextExecution>[0],
): ContextExecutionSnapshot {
	return execution.exit(() => captureContextExecution(settings));
}
