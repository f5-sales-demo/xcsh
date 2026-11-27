import type { AnthropicHistoryPayload, Context, Model } from "@f5-sales-demo/pi-ai";
import { type AnthropicOptions, streamAnthropic } from "@f5-sales-demo/pi-ai/providers/anthropic";

/** A native summary is accepted only when the provider returns its signed replay block. */
export async function requestAnthropicCompaction(
	model: Model<"anthropic-messages">,
	apiKey: string,
	context: Context,
	instructions?: string,
	signal?: AbortSignal,
	options: AnthropicOptions = {},
) {
	const response = await streamAnthropic(model, context, {
		...options,
		apiKey,
		signal,
		anthropicCompaction: { ...(instructions ? { instructions } : {}) },
		messageThreads: false,
	}).result();
	if (response.stopReason === "error" || response.stopReason === "aborted")
		throw new Error(response.errorMessage ?? "Anthropic server compaction failed");
	const payload = response.providerPayload;
	if (payload?.type !== "anthropicHistory")
		throw new Error("Anthropic server compaction returned no native replay payload");
	const summary = payload.blocks.find(
		block => block.type === "compaction" && typeof block.signature === "string" && block.signature.length > 0,
	);
	if (!summary || typeof summary.content !== "string")
		throw new Error("Anthropic server compaction returned no signed summary");
	return {
		summary: summary.content as string,
		payload: { ...payload, blocks: [summary] } as AnthropicHistoryPayload,
		usage: response.usage,
	};
}
