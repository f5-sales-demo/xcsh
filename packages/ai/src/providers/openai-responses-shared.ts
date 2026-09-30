import { structuredCloneJSON } from "@f5-sales-demo/pi-utils";
import type OpenAI from "openai";
import type {
	ResponseFunctionToolCall,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputItem,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses";
import { calculateCost } from "../models";
import type {
	Api,
	AssistantMessage,
	AssistantMessagePhase,
	ImageContent,
	Model,
	StopReason,
	TextContent,
	TextSignatureV1,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
} from "../types";
import { normalizeResponsesToolCallId } from "../utils";
import type { AssistantMessageEventStream } from "../utils/event-stream";
import { parseStreamingJson } from "../utils/json-parse";

export function encodeTextSignatureV1(id: string, phase?: TextSignatureV1["phase"]): string {
	const payload: TextSignatureV1 = { v: 1, id };
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}

export function resolveAssistantMessagePhase(phase: unknown): AssistantMessagePhase {
	return phase === "commentary" ? "commentary" : "final_answer";
}

export function parseTextSignature(
	signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
	if (!signature) return undefined;
	if (signature.startsWith("{")) {
		try {
			const parsed = JSON.parse(signature) as Partial<TextSignatureV1>;
			if (parsed.v === 1 && typeof parsed.id === "string") {
				if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
					return { id: parsed.id, phase: parsed.phase };
				}
				return { id: parsed.id };
			}
		} catch {
			// Fall through to legacy plain-string handling.
		}
	}
	return { id: signature };
}

export function normalizeResponsesToolCallIdForTransform(
	id: string,
	model?: Model<Api>,
	source?: AssistantMessage,
): string {
	if (!id.includes("|")) return id;
	const isForeignToolCall =
		source != null && model != null && (source.provider !== model.provider || source.api !== model.api);
	if (isForeignToolCall) {
		const [callId, itemId] = id.split("|");
		const normalizeIdPart = (part: string): string => {
			const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
			const truncated = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
			return truncated.replace(/_+$/, "");
		};
		const normalizedCallId = normalizeIdPart(callId);
		let normalizedItemId = `fc_${Bun.hash(itemId).toString(36)}`;
		if (normalizedItemId.length > 64) normalizedItemId = normalizedItemId.slice(0, 64);
		return `${normalizedCallId}|${normalizedItemId}`;
	}
	const normalized = normalizeResponsesToolCallId(id);
	return `${normalized.callId}|${normalized.itemId}`;
}

export function collectKnownCallIds(messages: ResponseInput): Set<string> {
	const knownCallIds = new Set<string>();
	for (const item of messages) {
		if (item.type === "function_call" && typeof item.call_id === "string") {
			knownCallIds.add(item.call_id);
		}
	}
	return knownCallIds;
}

export function convertResponsesInputContent(
	content: string | Array<TextContent | ImageContent>,
	supportsImages: boolean,
): ResponseInputContent[] | undefined {
	if (typeof content === "string") {
		if (content.trim().length === 0) return undefined;
		return [{ type: "input_text", text: content.toWellFormed() } satisfies ResponseInputText];
	}

	const normalizedContent = content
		.map((item): ResponseInputContent => {
			if (item.type === "text") {
				return {
					type: "input_text",
					text: item.text.toWellFormed(),
					...(item.promptCacheBreakpoint ? { prompt_cache_breakpoint: item.promptCacheBreakpoint } : {}),
				} satisfies ResponseInputText;
			}
			return {
				type: "input_image",
				detail: "auto",
				image_url: `data:${item.mimeType};base64,${item.data}`,
				...(item.promptCacheBreakpoint ? { prompt_cache_breakpoint: item.promptCacheBreakpoint } : {}),
			} satisfies ResponseInputImage;
		})
		.filter(item => supportsImages || item.type !== "input_image")
		.filter(item => item.type !== "input_text" || item.text.trim().length > 0);

	return normalizedContent.length > 0 ? normalizedContent : undefined;
}

export function convertResponsesAssistantMessage<TApi extends Api>(
	assistantMsg: AssistantMessage,
	model: Model<TApi>,
	msgIndex: number,
	knownCallIds: Set<string>,
	includeThinkingSignatures = true,
): ResponseInput {
	const outputItems: ResponseInput = [];
	const isDifferentModel =
		assistantMsg.model !== model.id && assistantMsg.provider === model.provider && assistantMsg.api === model.api;

	for (const block of assistantMsg.content) {
		if (block.type === "thinking" && assistantMsg.stopReason !== "error") {
			if (!includeThinkingSignatures) {
				continue;
			}
			if (block.thinkingSignature) {
				outputItems.push(JSON.parse(block.thinkingSignature) as ResponseReasoningItem);
			}
			continue;
		}

		if (block.type === "text") {
			const parsedSignature = parseTextSignature(block.textSignature);
			let msgId = parsedSignature?.id;
			if (!msgId) {
				msgId = `msg_${msgIndex}`;
			} else if (msgId.length > 64) {
				msgId = `msg_${Bun.hash(msgId).toString(36)}`;
			}
			outputItems.push({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: block.text.toWellFormed(), annotations: [] }],
				status: "completed",
				id: msgId,
				phase: parsedSignature?.phase ?? block.phase,
			} satisfies ResponseOutputMessage);
			continue;
		}

		if (block.type !== "toolCall") {
			continue;
		}

		const normalized = normalizeResponsesToolCallId(block.id);
		let itemId: string | undefined = normalized.itemId;
		if (isDifferentModel && (itemId?.startsWith("fc_") || itemId?.startsWith("fcr_"))) {
			itemId = undefined;
		}
		knownCallIds.add(normalized.callId);
		if (
			block.toolSearch &&
			assistantMsg.provider === model.provider &&
			(model.compat as import("../types").OpenAIResponsesCompat | undefined)?.supportsToolSearch
		) {
			outputItems.push({
				type: "tool_search_call",
				id: itemId,
				call_id: normalized.callId,
				execution: "client",
				status: "completed",
				arguments: block.arguments,
			} as unknown as ResponseInput[number]);
			continue;
		}
		if (block.customInputProperty && assistantMsg.provider === model.provider && assistantMsg.model === model.id) {
			outputItems.push({
				type: "custom_tool_call",
				id: itemId,
				call_id: normalized.callId,
				name: block.name,
				input: String(block.arguments[block.customInputProperty]),
				...(block.namespace ? { namespace: block.namespace } : {}),
			} as unknown as ResponseInput[number]);
			continue;
		}
		outputItems.push({
			...(block.namespace && assistantMsg.provider === model.provider ? { namespace: block.namespace } : {}),
			type: "function_call",
			id: itemId,
			call_id: normalized.callId,
			name: block.name,
			arguments: JSON.stringify(block.arguments),
		});
	}

	return outputItems;
}

export function appendResponsesToolResultMessages<TApi extends Api>(
	messages: ResponseInput,
	toolResult: ToolResultMessage,
	model: Model<TApi>,
	strictResponsesPairing: boolean,
	knownCallIds: ReadonlySet<string>,
): void {
	const textResult = toolResult.content
		.filter((block): block is TextContent => block.type === "text")
		.map(block => block.text)
		.join("\n");
	const hasImages = toolResult.content.some((block): block is ImageContent => block.type === "image");
	const normalized = normalizeResponsesToolCallId(toolResult.toolCallId);
	if (strictResponsesPairing && !knownCallIds.has(normalized.callId)) {
		return;
	}

	messages.push({
		type: toolResult.customTool ? "custom_tool_call_output" : "function_call_output",
		call_id: normalized.callId,
		output: (textResult.length > 0 ? textResult : "(see attached image)").toWellFormed(),
	} as ResponseInput[number]);

	if (!hasImages || !model.input.includes("image")) {
		return;
	}

	const contentParts: ResponseInputContent[] = [
		{ type: "input_text", text: "Attached image(s) from tool result:" } satisfies ResponseInputText,
	];
	for (const block of toolResult.content) {
		if (block.type === "image") {
			contentParts.push({
				type: "input_image",
				detail: "auto",
				image_url: `data:${block.mimeType};base64,${block.data}`,
			} satisfies ResponseInputImage);
		}
	}
	messages.push({ role: "user", content: contentParts });
}

export interface ProcessResponsesStreamOptions {
	onProviderStreamEvent?: import("../types").StreamOptions["onProviderStreamEvent"];
	signal?: AbortSignal;
	grammarToolInputProperties?: ReadonlyMap<string, string>;
	serviceTier?: string;
	onFirstToken?: () => void;
	onOutputItemDone?: (item: ResponseOutputItem) => void;
}

export async function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options?: ProcessResponsesStreamOptions,
): Promise<void> {
	let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
	let currentIndex = -1;
	let fallbackOutputIndex = -1;
	let sawTerminal = false;
	const slots = new Map<
		number,
		{
			item: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null;
			block: ThinkingContent | TextContent | (ToolCall & { partialJson?: string }) | null;
			index: number;
		}
	>();
	const completedItems = new Set<string>();
	const reasoningById = new Map<string, ThinkingContent>();
	let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson?: string }) | null = null;
	const blockIndex = () => currentIndex;
	let sawFirstToken = false;

	for await (const rawEvent of openaiStream) {
		await options?.onProviderStreamEvent?.(rawEvent, model);
		const event = rawEvent as typeof rawEvent & { output_index?: number };
		if (event.type !== "response.output_item.added" && event.output_index !== undefined) {
			const slot = slots.get(event.output_index);
			currentItem = slot?.item ?? null;
			currentBlock = slot?.block ?? null;
			currentIndex = slot?.index ?? -1;
		}
		if (event.type === "response.created") {
			output.responseId = event.response.id;
			if (event.response.model) {
				output.responseAttribution = {
					...(output.responseAttribution ?? { requestedModel: model.id }),
					responseModel: event.response.model,
					responseModelSource: "response-body",
				};
			}
		} else if (event.type === "response.output_item.added") {
			if (
				event.item.id &&
				(completedItems.has(event.item.id) || [...slots.values()].some(slot => slot.item?.id === event.item.id))
			)
				continue;
			if (!sawFirstToken) {
				sawFirstToken = true;
				options?.onFirstToken?.();
			}
			const item = event.item;
			currentItem = null;
			currentBlock = null;
			currentIndex = output.content.length;
			fallbackOutputIndex++;
			if (item.type === "reasoning") {
				currentItem = item;
				currentBlock = { type: "thinking", thinking: "" };
				output.content.push(currentBlock);
				stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
			} else if (item.type === "message") {
				currentItem = item;
				currentBlock = { type: "text", text: "", phase: resolveAssistantMessagePhase(item.phase) };
				output.content.push(currentBlock);
				stream.push({
					type: "text_start",
					contentIndex: blockIndex(),
					phase: currentBlock.phase ?? "final_answer",
					partial: output,
				});
			} else if (item.type === "function_call") {
				currentItem = item;
				currentBlock = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: {},
					partialJson: item.arguments || "",
				};
				output.content.push(currentBlock);
				stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
			} else if (
				(item as { type: string }).type === "tool_search_call" &&
				(model.compat as import("../types").OpenAIResponsesCompat | undefined)?.supportsToolSearch &&
				(item as unknown as { execution?: string }).execution === "client"
			) {
				const search = item as unknown as { id?: string; call_id: string; arguments: Record<string, unknown> };
				if (!search.call_id) throw new Error("Client tool search missing call_id");
				currentItem = item as unknown as typeof currentItem;
				currentBlock = {
					type: "toolCall",
					toolSearch: true,
					id: `${search.call_id}|${search.id ?? search.call_id}`,
					name: "search_tool_bm25",
					arguments: search.arguments,
					partialJson: "",
				};
				output.content.push(currentBlock);
				stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
			} else if ((item as { type: string }).type === "custom_tool_call") {
				const custom = item as unknown as {
					id: string;
					call_id: string;
					name: string;
					input?: string;
					namespace?: string;
				};
				currentItem = item as unknown as typeof currentItem;
				currentBlock = {
					type: "toolCall",
					id: `${custom.call_id}|${custom.id}`,
					name: custom.name,
					arguments: { [options?.grammarToolInputProperties?.get(custom.name) ?? "input"]: custom.input ?? "" },
					customInputProperty: options?.grammarToolInputProperties?.get(custom.name) ?? "input",
					partialJson: "",
					...(custom.namespace ? { namespace: custom.namespace } : {}),
				};
				output.content.push(currentBlock);
				stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
			}
			slots.set(event.output_index ?? fallbackOutputIndex, {
				item: currentItem,
				block: currentBlock,
				index: currentIndex,
			});
		} else if (event.type === "response.reasoning_summary_part.added") {
			if (currentItem?.type === "reasoning") {
				currentItem.summary = currentItem.summary || [];
				currentItem.summary.push(event.part);
			}
		} else if (event.type === "response.reasoning_summary_text.delta") {
			if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
				currentItem.summary = currentItem.summary || [];
				const lastPart = currentItem.summary[currentItem.summary.length - 1];
				if (lastPart) {
					currentBlock.thinking += event.delta;
					lastPart.text += event.delta;
					stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: event.delta,
						partial: output,
					});
				}
			}
		} else if (event.type === "response.reasoning_summary_part.done") {
			if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
				currentItem.summary = currentItem.summary || [];
				const lastPart = currentItem.summary[currentItem.summary.length - 1];
				if (lastPart) {
					currentBlock.thinking += "\n\n";
					lastPart.text += "\n\n";
					stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: "\n\n",
						partial: output,
					});
				}
			}
		} else if (event.type === "response.content_part.added") {
			if (currentItem?.type === "message") {
				currentItem.content = currentItem.content || [];
				if (event.part.type === "output_text" || event.part.type === "refusal") {
					currentItem.content.push(event.part);
				}
			}
		} else if (event.type === "response.output_text.delta") {
			if (currentItem?.type === "message" && currentBlock?.type === "text") {
				const lastPart = currentItem.content?.[currentItem.content.length - 1];
				if (lastPart?.type === "output_text") {
					currentBlock.text += event.delta;
					lastPart.text += event.delta;
					stream.push({
						type: "text_delta",
						contentIndex: blockIndex(),
						delta: event.delta,
						partial: output,
					});
				}
			}
		} else if (event.type === "response.refusal.delta") {
			if (currentItem?.type === "message" && currentBlock?.type === "text") {
				const lastPart = currentItem.content?.[currentItem.content.length - 1];
				if (lastPart?.type === "refusal") {
					currentBlock.text += event.delta;
					lastPart.refusal += event.delta;
					stream.push({
						type: "text_delta",
						contentIndex: blockIndex(),
						delta: event.delta,
						partial: output,
					});
				}
			}
		} else if ((event as { type: string }).type === "response.custom_tool_call_input.delta") {
			if (currentBlock?.type === "toolCall") {
				const delta = (event as unknown as { delta: string }).delta;
				const property = currentBlock.customInputProperty ?? "input";
				currentBlock.arguments[property] = String(currentBlock.arguments[property] ?? "") + delta;
				stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta, partial: output });
			}
		} else if (event.type === "response.function_call_arguments.delta") {
			if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
				currentBlock.partialJson = (currentBlock.partialJson ?? "") + event.delta;
				currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
				stream.push({
					type: "toolcall_delta",
					contentIndex: blockIndex(),
					delta: event.delta,
					partial: output,
				});
			}
		} else if (event.type === "response.function_call_arguments.done") {
			if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
				currentBlock.partialJson = event.arguments;
				currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
			}
		} else if (event.type === "response.output_item.done") {
			const item = structuredCloneJSON(event.item);
			if (item.id && completedItems.has(item.id)) continue;
			if (item.id) completedItems.add(item.id);
			options?.onOutputItemDone?.(item);
			if (item.type === "reasoning" && currentBlock?.type === "thinking") {
				currentBlock.thinking = item.summary?.map(part => part.text).join("\n\n") || "";
				currentBlock.thinkingSignature = JSON.stringify(item);
				if (item.id) reasoningById.set(item.id, currentBlock);
				stream.push({
					type: "thinking_end",
					contentIndex: blockIndex(),
					content: currentBlock.thinking,
					partial: output,
				});
				currentBlock = null;
			} else if (item.type === "message" && currentBlock?.type === "text") {
				currentBlock.text = item.content
					.map(part => (part.type === "output_text" ? (part.text ?? "") : (part.refusal ?? "")))
					.join("");
				currentBlock.phase = resolveAssistantMessagePhase(item.phase);
				currentBlock.textSignature = encodeTextSignatureV1(item.id, currentBlock.phase);
				stream.push({
					type: "text_end",
					contentIndex: blockIndex(),
					content: currentBlock.text,
					phase: currentBlock.phase ?? "final_answer",
					partial: output,
				});
				currentBlock = null;
			} else if (item.type === "function_call" && currentBlock?.type === "toolCall") {
				const block = currentBlock as ToolCall & { partialJson?: string };
				block.arguments = parseStreamingJson(item.arguments || block.partialJson || "{}");
				const namespace = (item as unknown as { namespace?: string }).namespace;
				if (namespace !== undefined) block.namespace = namespace;
				delete block.partialJson;
				stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall: block, partial: output });
				currentBlock = null;
			} else if (
				(item as { type: string }).type === "tool_search_call" &&
				currentBlock?.type === "toolCall" &&
				currentBlock.toolSearch
			) {
				const block = currentBlock as ToolCall & { partialJson?: string };
				block.arguments = (item as unknown as { arguments: Record<string, unknown> }).arguments;
				delete block.partialJson;
				stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall: block, partial: output });
				currentBlock = null;
			} else if ((item as { type: string }).type === "custom_tool_call" && currentBlock?.type === "toolCall") {
				const custom = item as unknown as { input?: string; namespace?: string };
				const block = currentBlock as ToolCall & { partialJson?: string };
				const property = block.customInputProperty ?? "input";
				block.arguments = { [property]: custom.input ?? String(block.arguments[property] ?? "") };
				if (custom.namespace !== undefined) block.namespace = custom.namespace;
				delete block.partialJson;
				stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall: block, partial: output });
				currentBlock = null;
			}
			slots.delete(event.output_index ?? fallbackOutputIndex);
		} else if (event.type === "response.completed" || event.type === "response.incomplete") {
			sawTerminal = true;
			const response = event.response;
			for (const item of response.output ?? []) {
				if (item.type !== "reasoning" || !item.encrypted_content) continue;
				const block = reasoningById.get(item.id);
				if (completedItems.has(item.id)) options?.onOutputItemDone?.(item);
				if (block?.thinkingSignature)
					block.thinkingSignature = JSON.stringify({
						...JSON.parse(block.thinkingSignature),
						encrypted_content: item.encrypted_content,
					});
			}
			if (response?.model) {
				output.responseAttribution = {
					...(output.responseAttribution ?? { requestedModel: model.id }),
					responseModel: response.model,
					responseModelSource: "response-body",
				};
			}
			if (response?.id) {
				output.responseId = response.id;
			}
			if (response?.usage) {
				const details = response.usage.input_tokens_details as
					| { cached_tokens?: number; cache_write_tokens?: number }
					| undefined;
				const cachedTokens = details?.cached_tokens || 0;
				const cacheWriteTokens = details?.cache_write_tokens || 0;
				const cacheReadTokens = cachedTokens;
				output.usage = {
					input: Math.max(0, (response.usage.input_tokens || 0) - cacheReadTokens - cacheWriteTokens),
					output: response.usage.output_tokens || 0,
					cacheRead: cacheReadTokens,
					cacheWrite: cacheWriteTokens,
					...(details?.cache_write_tokens !== undefined ? { cacheWriteTokens } : {}),
					...(response.usage.output_tokens_details?.reasoning_tokens !== undefined
						? { reasoningTokens: response.usage.output_tokens_details.reasoning_tokens }
						: {}),
					totalTokens: response.usage.total_tokens || 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
			}
			calculateCost(model, output.usage);
			const tier = response.service_tier ?? options?.serviceTier;
			const multiplier = tier === "priority" ? 2 : tier === "flex" ? 0.5 : 1;
			if (model.provider !== "openai-codex" && multiplier !== 1) {
				for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const)
					output.usage.cost[key] *= multiplier;
			}
			output.stopReason = mapOpenAIResponsesStopReason(response?.status);
			if (output.content.some(block => block.type === "toolCall") && output.stopReason === "stop") {
				output.stopReason = "toolUse";
			}
		} else if (event.type === "error") {
			throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
		} else if (event.type === "response.failed") {
			const error = event.response?.error;
			const details = event.response?.incomplete_details;
			const message = error
				? `${error.code || "unknown"}: ${error.message || "no message"}`
				: details?.reason
					? `incomplete: ${details.reason}`
					: "Unknown error (no error details in response)";
			throw new Error(message);
		}
	}
	if (options?.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
	if (!sawTerminal) throw new Error("OpenAI Responses stream ended before a terminal response event");
	if (output.content.some(block => block.type === "toolCall" && "partialJson" in block)) {
		throw new Error("OpenAI Responses completed with an unfinished tool call");
	}
}

export function mapOpenAIResponsesStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		case "in_progress":
		case "queued":
			return "stop";
		default: {
			const exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${exhaustive}`);
		}
	}
}
