import { AsyncLocalStorage } from "node:async_hooks";

export interface ContextExecutionSnapshot {
	readonly environment: Readonly<Record<string, string>>;
	readonly sensitiveKeys: readonly string[];
	readonly source: "local" | "global";
}

const execution = new AsyncLocalStorage<ContextExecutionSnapshot>();

/** Private runtime data only. Never serialize this credential-bearing snapshot. */
export function currentContextExecution(): ContextExecutionSnapshot | undefined {
	return execution.getStore();
}

export function captureContextExecution(settings: {
	get(key: "bash.environment"): unknown;
	get(key: "xcsh.sensitiveKeys"): unknown;
	get(key: "xcsh.contextSource"): unknown;
}): ContextExecutionSnapshot {
	const inherited = execution.getStore();
	if (inherited) return inherited;
	const environment = { ...((settings.get("bash.environment") ?? {}) as Record<string, string>) };
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("XCSH_") && value !== undefined) environment[key] = value;
	}
	return Object.freeze({
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
	return execution.getStore() ? execution.getStore()!.environment[key] : process.env[key];
}

export function captureNextContextExecution(
	settings: Parameters<typeof captureContextExecution>[0],
): ContextExecutionSnapshot {
	return execution.exit(() => captureContextExecution(settings));
}
