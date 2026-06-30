/**
 * Idempotency for create automations. Creating an object that already exists
 * produces an error on the F5 console (and the API). To make create workflows
 * idempotent, the runner does a PRE-FLIGHT existence check and decides what to
 * do based on the configured mode:
 *
 *   - "skip"     (default): if it already exists, skip the form and report success
 *                — re-running the automation is a no-op, the desired state holds.
 *   - "recreate":          delete the existing object first, then run the form
 *                — guarantees a fresh create (used by the sweep harness).
 *   - "error":             run the form anyway (legacy — will hit the console's
 *                "object already exists" error; surfaced, not swallowed).
 *
 * Plus a post-save detector: if a save DID hit an already-exists error, that's
 * idempotently fine — the object is present, which is the desired state.
 */
export type IdempotencyMode = "skip" | "recreate" | "error";

export type PreflightAction = "proceed" | "skip" | "delete-first";

/** Decide the pre-flight action from whether the object exists + the mode. */
export function resolvePreflightAction(exists: boolean, mode: IdempotencyMode): PreflightAction {
	if (!exists) return "proceed";
	switch (mode) {
		case "skip":
			return "skip";
		case "recreate":
			return "delete-first";
		case "error":
			return "proceed";
	}
}

/** True when an error/banner text indicates the object already exists. */
export function isAlreadyExistsError(text: string | null | undefined): boolean {
	if (!text) return false;
	return /already\s+exists|duplicate\s+(key|entry|object)|object.*exists|409|conflict/i.test(text);
}
