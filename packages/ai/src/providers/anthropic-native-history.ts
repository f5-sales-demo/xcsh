import type { AssistantMessage, Model, ModelCost, Usage } from "../types";

function effectiveRates(cost: ModelCost, totalInput: number): ModelCost {
	let rates = cost;
	let threshold = -1;
	for (const tier of cost.tiers ?? [])
		if (totalInput > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
			rates = tier;
			threshold = tier.inputTokensAbove;
		}
	return rates;
}

export function applyAnthropicCacheCreation(source: Record<string, any>, usage: Usage, rates: ModelCost): void {
	rates = effectiveRates(rates, usage.input + usage.cacheRead + usage.cacheWrite);
	if (source.cache_creation != null)
		usage.cacheCreation = {
			ephemeral5m: source.cache_creation.ephemeral_5m_input_tokens ?? 0,
			ephemeral1h: source.cache_creation.ephemeral_1h_input_tokens ?? 0,
		};
	const buckets = usage.cacheCreation;
	if (!buckets) return;
	const oneHour = Math.min(buckets.ephemeral1h, usage.cacheWrite);
	usage.cost.cacheWrite = ((usage.cacheWrite - oneHour) * rates.cacheWrite + oneHour * rates.input * 2) / 1_000_000;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

/** Preserve provider-owned bytes separately from client-executable content. */
export class AnthropicNativeHistory {
	constructor(readonly endpoint?: string) {}
	#blocks = new Map<number, { block: Record<string, any>; json: string }>();
	#native = false;
	consume(event: Record<string, any>): void {
		if (event.type === "content_block_start") {
			const block = structuredClone(event.content_block);
			if (
				["compaction", "fallback", "web_fetch_tool_result", "web_search_tool_result", "server_tool_use"].includes(
					block.type,
				)
			)
				this.#native = true;
			this.#blocks.set(event.index, { block, json: "" });
		} else if (event.type === "content_block_delta") {
			const state = this.#blocks.get(event.index);
			if (!state) return;
			const delta = event.delta;
			if (delta.type === "text_delta") state.block.text = (state.block.text ?? "") + delta.text;
			else if (delta.type === "thinking_delta") state.block.thinking = (state.block.thinking ?? "") + delta.thinking;
			else if (delta.type === "signature_delta")
				state.block.signature = (state.block.signature ?? "") + delta.signature;
			else if (delta.type === "compaction_delta") state.block.content = (state.block.content ?? "") + delta.content;
			else if (delta.type === "input_json_delta") state.json += delta.partial_json;
			else if (delta.type === "citations_delta") {
				state.block.citations ??= [];
				state.block.citations.push(structuredClone(delta.citation));
			}
		} else if (event.type === "content_block_stop") {
			const state = this.#blocks.get(event.index);
			if (state?.json.trim()) {
				try {
					state.block.input = JSON.parse(state.json);
				} catch (error) {
					throw new Error(`Anthropic returned malformed completed tool input JSON for "${state.block.name}"`, {
						cause: error,
					});
				}
			}
		}
	}
	attach(output: AssistantMessage): void {
		if (!this.#native) return;
		output.providerPayload = {
			type: "anthropicHistory",
			endpoint: this.endpoint,
			provider: output.provider,
			model: output.model,
			blocks: [...this.#blocks.values()].map(state => state.block),
		};
	}
}

/** Iterations are the billing total; do not add them to the aggregate again. */
export function applyAnthropicIterationUsage(
	source: Record<string, any>,
	usage: Usage,
	model: Model,
	fallbacks: { model: string; cost?: ModelCost }[] = [],
): string | undefined {
	const iterations = source.iterations;
	if (!Array.isArray(iterations) || iterations.length === 0) return undefined;
	let served: string | undefined;
	usage.input = usage.output = usage.cacheRead = usage.cacheWrite = 0;
	usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	usage.costKnown = true;
	let fiveMinute = 0;
	let oneHour = 0;
	const hasFallback = iterations.some(iteration => iteration.type === "fallback_message");
	for (const iteration of iterations) {
		const isFallback = iteration.type === "fallback_message";
		if (isFallback && typeof iteration.model === "string") served = iteration.model;
		const cost =
			iteration.model === model.id || !iteration.model
				? model.cost
				: fallbacks.find(target => target.model === iteration.model)?.cost;
		const input = iteration.input_tokens ?? 0;
		const output = iteration.output_tokens ?? 0;
		const read = iteration.cache_read_input_tokens ?? 0;
		const write = iteration.cache_creation_input_tokens ?? 0;
		usage.input += input;
		usage.output += output;
		usage.cacheRead += read;
		usage.cacheWrite += write;
		fiveMinute += iteration.cache_creation?.ephemeral_5m_input_tokens ?? 0;
		oneHour += iteration.cache_creation?.ephemeral_1h_input_tokens ?? 0;
		if (hasFallback && !isFallback && output === 0 && write === 0) continue;
		if (!cost || cost.pricingKnown === false) {
			usage.costKnown = false;
			continue;
		}
		const rates = effectiveRates(cost, input + read + write);
		usage.cost.input += (input * (isFallback ? rates.cacheRead : rates.input)) / 1_000_000;
		usage.cost.output += (output * rates.output) / 1_000_000;
		usage.cost.cacheRead += (read * rates.cacheRead) / 1_000_000;
		const hourWrites = Math.min(iteration.cache_creation?.ephemeral_1h_input_tokens ?? 0, write);
		usage.cost.cacheWrite += ((write - hourWrites) * rates.cacheWrite + hourWrites * rates.input * 2) / 1_000_000;
	}
	usage.cacheCreation = { ephemeral5m: fiveMinute, ephemeral1h: oneHour };
	usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return served;
}
