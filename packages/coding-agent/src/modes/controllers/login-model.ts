import type { Model } from "@f5-sales-demo/pi-ai";

/**
 * Minimal session surface needed to apply a model after a successful login.
 * Kept structural so the login flow can call it without pulling in the full
 * AgentSession type, and so it stays trivially unit-testable.
 */
interface ModelApplicableSession {
	model: Model | undefined;
	modelRegistry: { getAll(): Model[] };
	setModel(model: Model, role: "default", options?: { selector?: string }): Promise<void>;
}

/**
 * After a successful `/login`, make the freshly-configured provider immediately
 * usable by setting it as the session's default model — but only when the session
 * has no model yet, so we never override a model the user already chose.
 *
 * Returns true when a model was applied. The login wizard auto-selects a model id
 * from the provider's /models list; resolving it here (post-registry-refresh) is
 * what lets the LLM readiness gate lift without a manual `/model` step.
 */
export async function applyModelAfterLogin(
	session: ModelApplicableSession,
	selectedModelId: string | undefined,
): Promise<boolean> {
	if (session.model || !selectedModelId) return false;
	const resolved = session.modelRegistry.getAll().find(m => m.id === selectedModelId);
	if (!resolved) return false;
	await session.setModel(resolved, "default", { selector: resolved.id });
	return true;
}
