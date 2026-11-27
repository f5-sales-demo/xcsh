import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { AnthropicRequestControls, Context, Model } from "../types";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function getAnthropicContextBetas(context: Context, model: Model<"anthropic-messages">): string[] {
	if (!model.compat?.supportsMidConvoToolChanges) return [];
	const defined = new Set(context.tools?.map(tool => tool.name) ?? []);
	for (const message of context.messages) {
		if (message.role === "developer")
			for (const tool of message.toolsAdded ?? []) {
				if (defined.has(tool.name)) return ["inline-tools-2026-09-15"];
				defined.add(tool.name);
			}
		const payload = message.role === "assistant" || message.role === "user" ? message.providerPayload : undefined;
		if (
			payload?.type === "anthropicHistory" &&
			payload.blocks.some(block =>
				block.tool_changes?.some((change: Record<string, any>) => change.tool?.type === "tool_definition"),
			)
		)
			return ["inline-tools-2026-09-15"];
	}
	return [];
}

export function validateAnthropicControls(
	options: AnthropicRequestControls & { effort?: string; maxTokens?: number },
): void {
	if (options.thinkingDisplay !== undefined && !["summarized", "omitted"].includes(options.thinkingDisplay))
		throw new Error("Anthropic thinkingDisplay must be summarized or omitted");
	if (
		options.anthropicPrefixMismatchBehavior !== undefined &&
		!["drop_block", "error"].includes(options.anthropicPrefixMismatchBehavior)
	)
		throw new Error("Anthropic prefix mismatch behavior must be drop_block or error");
	if (options.effort !== undefined && !EFFORTS.has(options.effort))
		throw new Error("Anthropic effort must be low, medium, high, xhigh or max");
	if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0))
		throw new Error("Anthropic maxTokens must be a positive integer");
	const budget = options.taskBudget;
	if (
		budget &&
		(budget.type !== "tokens" ||
			!Number.isSafeInteger(budget.total) ||
			budget.total <= 0 ||
			(budget.remaining !== undefined &&
				(!Number.isSafeInteger(budget.remaining) || budget.remaining < 0 || budget.remaining > budget.total)))
	)
		throw new Error("Anthropic task budget requires a positive total and remaining between zero and total");
	if (
		options.outputFormat &&
		(options.outputFormat.type !== "json_schema" ||
			!options.outputFormat.schema ||
			typeof options.outputFormat.schema !== "object" ||
			Array.isArray(options.outputFormat.schema))
	)
		throw new Error("Anthropic outputFormat requires a JSON schema");
	if (
		options.fallbacks &&
		(options.fallbacks.length > 3 || options.fallbacks.some(fallback => !fallback.model?.trim()))
	)
		throw new Error("Anthropic fallbacks require at most three named models");
}

export function getAnthropicControlBetas(
	options: AnthropicRequestControls & { serviceTier?: string; sessionId?: string },
	model: Model<"anthropic-messages">,
): string[] {
	const betas: string[] = [];
	if (options.anthropicPrefixMismatchBehavior) betas.push("thinking-binding-controls-2026-08-01");
	if (options.taskBudget) betas.push("task-budgets-2026-03-13");
	if (options.contextManagement) betas.push("context-management-2025-06-27");
	if (options.anthropicCompaction) betas.push("compact-2026-09-04");
	if (options.fallbacks?.length) betas.push("server-side-fallback-2026-06-01");
	if (options.fallbacks?.some(target => target.speed === "fast")) betas.push("fast-mode-2026-02-01");
	if (options.fallbacks?.some(target => target.output_config?.task_budget)) betas.push("task-budgets-2026-03-13");
	if (options.serviceTier === "priority") betas.push("fast-mode-2026-02-01");
	if (
		options.sessionId &&
		(options.messageThreads ??
			model.compat?.supportsMessageThreads ??
			new URL(model.baseUrl).hostname === "api.anthropic.com")
	)
		betas.push("message-threads-2026-08-12");
	if (model.compat?.supportsMidConvoEffort)
		betas.push("mid-conversation-output-config-2026-07-01", "thinking-binding-controls-2026-08-01");
	return betas;
}

/** Add provider-native controls without replacing effort or caller-owned objects. */
export function applyAnthropicControls(
	params: MessageCreateParamsStreaming,
	options: AnthropicRequestControls & { serviceTier?: string },
	model: Model<"anthropic-messages">,
): void {
	const fields: Record<string, unknown> = {};
	if (params.thinking && params.thinking.type !== "disabled") {
		fields.thinking = {
			...params.thinking,
			display: options.thinkingDisplay ?? "summarized",
			...(options.anthropicPrefixMismatchBehavior
				? { block_binding: { prefix_mismatch_behavior: options.anthropicPrefixMismatchBehavior } }
				: {}),
		};
	}
	const outputConfig: Record<string, unknown> = { ...params.output_config };
	if (options.outputFormat && !options.anthropicCompaction) outputConfig.format = options.outputFormat;
	if (options.taskBudget) {
		const budget = { ...options.taskBudget };
		if (options.anthropicCompaction) delete budget.remaining;
		outputConfig.task_budget = budget;
	}
	if (Object.keys(outputConfig).length) fields.output_config = outputConfig;
	if (options.contextManagement) fields.context_management = options.contextManagement;
	if (options.anthropicCompaction) fields.compaction = { type: "summarize", ...options.anthropicCompaction };
	if (options.serviceTier === "priority") {
		if (model.compat?.supportsFastMode === false) throw new Error("Anthropic fast mode is unsupported by this model");
		fields.speed = "fast";
	}
	if (options.fallbacks?.length)
		fields.fallbacks = options.fallbacks.map(({ cost: _cost, ...target }) => structuredClone(target));
	Object.assign(params, fields);
	normalizeAnthropicCompactionParams(params);
}

/** SDK compaction keeps sampling controls but has no post-summary generation. */
export function normalizeAnthropicCompactionParams(params: MessageCreateParamsStreaming): void {
	if (!(params as unknown as { compaction?: unknown }).compaction) return;
	delete (params as unknown as Record<string, unknown>).context_management;
	delete params.stop_sequences;
	if (params.tool_choice?.type === "any" || params.tool_choice?.type === "tool") params.tool_choice = { type: "auto" };
	if (params.output_config) {
		const { format: _format, ...config } = params.output_config as Record<string, unknown>;
		const budget = config.task_budget;
		if (budget && typeof budget === "object" && !Array.isArray(budget)) {
			const { remaining: _remaining, ...total } = budget as Record<string, unknown>;
			config.task_budget = total;
		}
		if (Object.keys(config).length) params.output_config = config as MessageCreateParamsStreaming["output_config"];
		else delete params.output_config;
	}
}
