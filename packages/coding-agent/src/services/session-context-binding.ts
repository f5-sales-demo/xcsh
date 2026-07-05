/**
 * Pure decisions for session-scoped context binding. No I/O — the caller
 * gathers inputs (available contexts, folder-local context, tenant key) and
 * performs the activation. Key-agnostic so the deferred extension/daemon phase
 * reuses it unchanged.
 */

export type SessionKind = "cli" | "extension";

export interface AutoBindInput {
	kind: SessionKind;
	/** Names of all available (global) contexts. */
	availableContexts: string[];
	/** CLI: the folder-local context name resolved from `.xcsh/`, if any. */
	folderContext?: string | null;
	/** Extension: the tenant|env key of the focused tab. */
	tenantKey?: string | null;
	/** Extension: contextName → its tenant|env key (derived from apiUrl). */
	contextTenantKeys?: Record<string, string>;
}

export type AutoBindResult = { kind: "bind"; contextName: string } | { kind: "needsSelection" } | { kind: "none" };

/** Decide which context (if any) a NEW session should auto-bind. */
export function resolveAutoBind(input: AutoBindInput): AutoBindResult {
	if (input.kind === "extension") {
		if (!input.tenantKey) return { kind: "none" };
		const match = Object.entries(input.contextTenantKeys ?? {}).find(([, key]) => key === input.tenantKey);
		return match ? { kind: "bind", contextName: match[0] } : { kind: "needsSelection" };
	}
	// cli
	if (input.folderContext) return { kind: "bind", contextName: input.folderContext };
	if (input.availableContexts.length === 1) return { kind: "bind", contextName: input.availableContexts[0] };
	if (input.availableContexts.length === 0) return { kind: "none" };
	return { kind: "needsSelection" };
}

export type SessionContextChoice = { activate: string } | { needsSelection: true } | { none: true };

/** Resume (boundContextName present) wins; otherwise fall back to the auto-bind result. */
export function chooseSessionContext(
	boundContextName: string | undefined,
	autoBind: AutoBindResult,
): SessionContextChoice {
	if (boundContextName) return { activate: boundContextName };
	if (autoBind.kind === "bind") return { activate: autoBind.contextName };
	if (autoBind.kind === "needsSelection") return { needsSelection: true };
	return { none: true };
}

/**
 * Activate the stored context matching a worker's tenant key ("tenant|env"), if any.
 * Extracted from the createAgentSession bootstrap so a pre-warmed spare worker can bind
 * its tenant AFTER startup (pool late-bind). Returns true if a context was activated.
 * Never throws when no context matches — the caller stays tenant-advertised/unbound.
 */
export async function activateTenantContext(tenantKey: string, bound: string | null = null): Promise<boolean> {
	const { ContextService } = await import("./xcsh-context");
	const { sessionKeyFromUrl } = await import("./xcsh-env");
	const svc = ContextService.instance;
	const contexts = await svc.listContexts();
	const contextTenantKeys: Record<string, string> = {};
	for (const c of contexts) {
		const key = c.apiUrl ? sessionKeyFromUrl(c.apiUrl) : null;
		if (key) contextTenantKeys[c.name] = `${key.tenant}|${key.env}`;
	}
	const autoBind = resolveAutoBind({
		kind: "extension",
		availableContexts: contexts.map(c => c.name),
		tenantKey,
		contextTenantKeys,
	});
	const choice = chooseSessionContext(bound ?? undefined, autoBind);
	if ("activate" in choice) {
		await svc.activate(choice.activate);
		await svc.validateToken();
		return true;
	}
	return false;
}
