import type { IntegrationHandle, IntegrationSetupPlan, IntegrationSetupStep, IntegrationSnapshot } from "./types";

export type SetupStepRunner = (step: IntegrationSetupStep, signal?: AbortSignal) => Promise<number>;

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

export const runSetupStep: SetupStepRunner = async (step, signal) => {
	const timeout = AbortSignal.timeout(step.timeoutMs);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		const child = Bun.spawn([...step.argv], {
			stdin: step.stdin === "inherit" || step.kind === "login" ? "inherit" : "ignore",
			stdout: "inherit",
			stderr: "inherit",
			signal: combined,
		});
		return await child.exited;
	} catch {
		return -1;
	}
};

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
