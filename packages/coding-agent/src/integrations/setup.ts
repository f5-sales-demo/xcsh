import type { IntegrationHandle, IntegrationSetupPlan, IntegrationSetupStep, IntegrationSnapshot } from "./types";

export type PluginSetupTrigger = "direct-install" | "bulk-install" | "upgrade" | "cache-refresh" | "dependency-install";

export interface InstallAuthorizedSetupOptions {
	readonly plugin: string;
	readonly lifecycle: { readonly setupRequired: boolean; readonly setupAuthorization?: "separate" | "install" };
	readonly trigger: PluginSetupTrigger;
	readonly handles: readonly IntegrationHandle<unknown>[];
	readonly run?: SetupStepRunner;
	readonly signal?: AbortSignal;
}

export type SetupStepRunner = (step: IntegrationSetupStep, signal?: AbortSignal) => Promise<number>;
export type SetupEnvironmentResolver = (name: string) => string | undefined;
export interface SetupStepRunnerOptions {
	readonly nonInteractiveOutput?: "inherit" | "ignore";
}

export function describeSetupPlan(handle: IntegrationHandle<unknown>): string {
	const plan = handle.setupPlan;
	if (!plan) return `${handle.name}: no setup is declared.`;
	const lines = [
		`${handle.name} setup plan`,
		`Plugin dependencies: ${plan.pluginDependencies.join(", ") || "none"}`,
		`Required environment names: ${plan.requiredEnvironment.join(", ") || "none"}`,
		`Person-profile categories: ${plan.profileFields.join(", ") || "none"}`,
		"Commands:",
		...plan.steps.map(step => `  ${step.kind}: ${JSON.stringify(step.argv)} (timeout ${step.timeoutMs}ms)`),
		"Verification:",
		...plan.verification.map(step => `  ${JSON.stringify(step.argv)} (timeout ${step.timeoutMs}ms)`),
	];
	return lines.join("\n");
}

export function createSetupStepRunner(
	resolveEnvironment: SetupEnvironmentResolver,
	options: SetupStepRunnerOptions = {},
): SetupStepRunner {
	return async (step, signal) => {
		const environment = { ...process.env };
		for (const name of step.environment ?? []) {
			const value = resolveEnvironment(name);
			if (value === undefined) delete environment[name];
			else environment[name] = value;
		}
		const timeout = AbortSignal.timeout(step.timeoutMs);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const interactiveInput = step.stdin === "inherit" || step.kind === "login";
		const output = step.kind === "login" ? "inherit" : (options.nonInteractiveOutput ?? "inherit");
		try {
			const child = Bun.spawn([...step.argv], {
				env: environment,
				stdin: interactiveInput ? "inherit" : "ignore",
				stdout: output,
				stderr: output,
				signal: combined,
			});
			return await child.exited;
		} catch {
			return -1;
		}
	};
}

export const runSetupStep = createSetupStepRunner(name => process.env[name]);

export async function executeReviewedSetup<T>(
	handle: IntegrationHandle<T>,
	reviewedPlan: IntegrationSetupPlan,
	run: SetupStepRunner = runSetupStep,
	signal?: AbortSignal,
): Promise<IntegrationSnapshot<T>> {
	if (reviewedPlan !== handle.setupPlan) throw new Error("Setup requires the current reviewed setup plan");
	for (const step of reviewedPlan.steps) {
		if (signal?.aborted) throw new Error("Integration setup cancelled");
		if ((await run(step, signal)) !== 0) throw new Error(`Integration ${step.kind} step failed`);
	}
	return handle.verifyAfterSetup(reviewedPlan, signal);
}

/**
 * Consume install-scoped setup authorization only for the reviewed root plugin.
 * Indirect installation surfaces deliberately return without inspecting handles.
 */
export async function executeInstallAuthorizedSetup(
	options: InstallAuthorizedSetupOptions,
): Promise<IntegrationSnapshot<unknown> | undefined> {
	if (
		options.trigger !== "direct-install" ||
		!options.lifecycle.setupRequired ||
		(options.lifecycle.setupAuthorization ?? "separate") !== "install"
	)
		return undefined;
	const matches = options.handles.filter(
		handle =>
			(handle.id === options.plugin ||
				handle.plugin === options.plugin ||
				handle.plugin?.split("@")[0] === options.plugin) &&
			handle.setupPlan !== undefined,
	);
	if (matches.length !== 1) {
		throw new Error(
			matches.length
				? `Plugin ${options.plugin} registers multiple setup plans; use an explicit plugin setup command.`
				: `Plugin ${options.plugin} authorized setup during install but no setup plan is registered.`,
		);
	}
	const handle = matches[0];
	const current = await handle.get(options.signal);
	if (current.state === "ready") return current;
	return executeReviewedSetup(handle, handle.setupPlan!, options.run, options.signal);
}
