/** Read-only compatibility views. These never load or change Codex configuration. */
export function configResponse(thread: Record<string, unknown> | undefined, includeLayers: boolean) {
	// Null denotes an unset Codex-specific setting, rather than a promise about
	// permissions or defaults in the existing XCSH terminal runtime.
	const config: Record<string, unknown> = Object.fromEntries(
		[
			"model",
			"review_model",
			"model_context_window",
			"model_auto_compact_token_limit",
			"model_auto_compact_token_limit_scope",
			"model_provider",
			"approval_policy",
			"approvals_reviewer",
			"sandbox_mode",
			"sandbox_workspace_write",
			"forced_chatgpt_workspace_id",
			"forced_login_method",
			"web_search",
			"tools",
			"instructions",
			"developer_instructions",
			"compact_prompt",
			"model_reasoning_effort",
			"model_reasoning_summary",
			"model_verbosity",
			"service_tier",
			"analytics",
			"apps",
			"browser_use",
			"computer_use",
			"desktop",
		].map(key => [key, null]),
	);
	config.model = thread?.model ?? null;
	config.model_provider = thread?.modelProvider ?? null;
	config.model_reasoning_effort = thread?.reasoningEffort ?? null;
	return { config, origins: {}, ...(includeLayers ? { layers: [] } : {}) };
}

export function modelResponse(threads: Record<string, unknown>[]) {
	const models = new Map<string, Record<string, unknown>>();
	for (const thread of threads) {
		if (typeof thread.model !== "string" || models.has(thread.model)) continue;
		models.set(thread.model, {
			id: thread.model,
			model: thread.model,
			displayName: thread.model,
			description: "Model selected by a live XCSH terminal. Model changes are managed in the terminal.",
			upgrade: null,
			upgradeInfo: null,
			availabilityNux: null,
			modelSpecialty: null,
			hidden: false,
			supportedReasoningEfforts: [],
			defaultReasoningEffort: thread.reasoningEffort ?? "medium",
			inputModalities: ["text"],
			supportsPersonality: false,
			multiAgentVersion: null,
			additionalSpeedTiers: [],
			serviceTiers: [],
			defaultServiceTier: null,
			isDefault: false,
		});
	}
	return { data: [...models.values()], nextCursor: null };
}
