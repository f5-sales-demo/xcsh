import { $env, structuredCloneJSON } from "@f5-sales-demo/pi-utils";
import OpenAI from "openai";
import type {
	Tool as OpenAITool,
	ResponseCreateParamsStreaming,
	ResponseInput,
} from "openai/resources/responses/responses";
import {
	type ReasoningSummary,
	resolveCodexWireReasoningEffort,
	resolveWireReasoningSummary,
	type WireReasoningSummary,
} from "../codex-model-interaction";
import type { ReasoningEffort } from "../model-thinking";
import { requireSupportedReasoningEffort } from "../model-thinking";
import { getEnvApiKey } from "../stream";
import {
	type Api,
	type AssistantMessage,
	type CacheRetention,
	type Context,
	isSpecialServiceTier,
	type MessageAttribution,
	type Model,
	type OpenAICompat,
	type ProviderSessionState,
	type ServiceTier,
	type StreamFunction,
	type StreamOptions,
	type Tool,
	type ToolChoice,
} from "../types";
import {
	createOpenAIResponsesHistoryPayload,
	getOpenAIResponsesHistoryItems,
	getOpenAIResponsesHistoryPayload,
	resolveCacheRetention,
	sanitizeOpenAIResponsesHistoryItemsForReplay,
} from "../utils";
import { createAbortSourceTracker } from "../utils/abort";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump, rewriteCopilotAuthError } from "../utils/http-inspector";
import {
	createFirstEventWatchdog,
	getOpenAIStreamIdleTimeoutMs,
	getStreamFirstEventTimeoutMs,
	iterateWithIdleTimeout,
	markFirstStreamEvent,
} from "../utils/idle-iterator";
import { parseGitHubCopilotApiKey } from "../utils/oauth/github-copilot";
import { retryProviderRequest } from "../utils/provider-retry";
import { adaptSchemaForStrict, NO_STRICT } from "../utils/schema";
import { mapToOpenAIResponsesToolChoice } from "../utils/tool-choice";
import { cloudflareGatewayHeaders, resolveCloudflareEndpoint } from "./cloudflare-route";
import {
	buildCopilotDynamicHeaders,
	hasCopilotVisionInput,
	resolveGitHubCopilotBaseUrl,
} from "./github-copilot-headers";
import { normalizeClientMetadata, truncateFunctionCallOutputs } from "./openai-codex/request-transformer";
import {
	appendResponsesToolResultMessages,
	collectKnownCallIds,
	convertResponsesAssistantMessage,
	convertResponsesInputContent,
	normalizeResponsesToolCallIdForTransform,
	processResponsesStream,
} from "./openai-responses-shared";
import { validateFinalResponsesRequest } from "./sol-request-boundary";
import { transformMessages } from "./transform-messages";

/**
 * Get prompt cache retention based on cacheRetention and base URL.
 * Only applies to direct OpenAI API calls (api.openai.com).
 */
function getPromptCacheRetention(baseUrl: string, cacheRetention: CacheRetention): "24h" | undefined {
	if (cacheRetention !== "long") {
		return undefined;
	}
	if (baseUrl.includes("api.openai.com")) {
		return "24h";
	}
	return undefined;
}

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	promptCache?: { mode: "implicit" | "explicit"; ttl?: "30m" };
	reasoning?: ReasoningEffort;
	reasoningSummary?: ReasoningSummary | null;
	textVerbosity?: "low" | "medium" | "high";
	serviceTier?: ServiceTier;
	toolChoice?: ToolChoice;
	/**
	 * Enforce strict tool call/result pairing when building Responses API inputs.
	 * Azure OpenAI and GitHub Copilot Responses paths require tool results to match prior tool calls.
	 */
	strictResponsesPairing?: boolean;
}

const OPENAI_RESPONSES_PROVIDER_SESSION_STATE_PREFIX = "openai-responses:";
const OPENAI_RESPONSES_FIRST_EVENT_TIMEOUT_MESSAGE =
	"OpenAI responses stream timed out while waiting for the first event";

interface OpenAIResponsesProviderSessionState extends ProviderSessionState {
	nativeHistoryReplayWarmed: boolean;
	originalReasoning?: ReasoningEffort;
	reasoningAnchors?: { position: number; effort: ReasoningEffort }[];
	reasoningPrefix?: string[];
	activeReasoning?: ReasoningEffort;
}

function createOpenAIResponsesProviderSessionState(): OpenAIResponsesProviderSessionState {
	const state: OpenAIResponsesProviderSessionState = {
		nativeHistoryReplayWarmed: false,
		close: () => {
			state.nativeHistoryReplayWarmed = false;
			state.originalReasoning = undefined;
			state.reasoningAnchors = undefined;
			state.reasoningPrefix = undefined;
			state.activeReasoning = undefined;
		},
	};
	return state;
}

function getOpenAIResponsesProviderSessionStateKey(model: Model<"openai-responses">): string {
	return `${OPENAI_RESPONSES_PROVIDER_SESSION_STATE_PREFIX}${JSON.stringify([model.provider, model.id, model.baseUrl])}`;
}

function getOpenAIResponsesProviderSessionState(
	model: Model<"openai-responses">,
	providerSessionState: Map<string, ProviderSessionState> | undefined,
): OpenAIResponsesProviderSessionState | undefined {
	if (!providerSessionState) return undefined;
	const key = getOpenAIResponsesProviderSessionStateKey(model);
	const existing = providerSessionState.get(key) as OpenAIResponsesProviderSessionState | undefined;
	if (existing) return existing;
	const created = createOpenAIResponsesProviderSessionState();
	providerSessionState.set(key, created);
	return created;
}

function canReplayOpenAIResponsesNativeHistory(
	providerSessionState: OpenAIResponsesProviderSessionState | undefined,
): boolean {
	return providerSessionState?.nativeHistoryReplayWarmed ?? true;
}

type OpenAIResponsesSamplingParams = Omit<ResponseCreateParamsStreaming, "reasoning"> & {
	reasoning?: {
		effort?: Exclude<ReasoningEffort, "ultra">;
		summary?: WireReasoningSummary;
	};
	top_p?: number;
	top_k?: number;
	min_p?: number;
	presence_penalty?: number;
	repetition_penalty?: number;
	client_metadata?: Record<string, string>;
};

/**
 * Generate function for OpenAI Responses API
 */
export const streamOpenAIResponses: StreamFunction<"openai-responses"> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	model = { ...model, baseUrl: resolveCloudflareEndpoint(model.provider, model.baseUrl, options) };

	// Start async processing
	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-responses" as Api,
			provider: model.provider,
			model: model.id,
			responseAttribution: { requestedModel: model.id },
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		let rawRequestDump: RawHttpRequestDump | undefined;
		const abortTracker = createAbortSourceTracker(options?.signal);
		const firstEventTimeoutAbortError = new Error(OPENAI_RESPONSES_FIRST_EVENT_TIMEOUT_MESSAGE);
		const { requestAbortController, requestSignal } = abortTracker;

		try {
			// Create OpenAI client
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const { client, copilotPremiumRequests, baseUrl } = createClient(
				model,
				context,
				apiKey,
				options?.headers,
				options?.initiatorOverride,
				options?.fetch,
			);
			const providerSessionState = getOpenAIResponsesProviderSessionState(model, options?.providerSessionState);
			let { params } = buildParams(model, context, options, providerSessionState, baseUrl);
			const idleTimeoutMs = getOpenAIStreamIdleTimeoutMs();
			const replacement = await options?.onPayload?.(params, model);
			if (replacement !== undefined) params = replacement as typeof params;
			validateFinalResponsesRequest(model, params as unknown as Record<string, unknown>);
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url: `${baseUrl ?? "https://api.openai.com/v1"}/responses`,
				body: params,
			};
			// The pinned SDK schema predates the provider's `max` effort value.
			const response = await retryProviderRequest(
				() =>
					client.responses
						.create(params as ResponseCreateParamsStreaming, {
							signal: requestSignal,
							maxRetries: 0,
						})
						.withResponse(),
				{ signal: requestSignal, maxRetries: options?.maxRetries ?? 2, maxRetryDelayMs: options?.maxRetryDelayMs },
			);
			await options?.onResponse?.(
				{ status: response.response.status, headers: Object.fromEntries(response.response.headers.entries()) },
				model,
			);
			const openaiStream = response.data;
			const firstEventWatchdog = createFirstEventWatchdog(
				options?.streamFirstEventTimeoutMs ?? getStreamFirstEventTimeoutMs(idleTimeoutMs),
				() => abortTracker.abortLocally(firstEventTimeoutAbortError),
			);
			if (copilotPremiumRequests !== undefined) output.usage.premiumRequests = copilotPremiumRequests;
			stream.push({ type: "start", partial: output });

			const nativeOutputItems: Array<Record<string, unknown>> = [];
			await processResponsesStream(
				iterateWithIdleTimeout(markFirstStreamEvent(openaiStream, firstEventWatchdog), {
					idleTimeoutMs,
					errorMessage: "OpenAI responses stream stalled while waiting for the next event",
					onIdle: () => requestAbortController.abort(),
				}),
				output,
				stream,
				model,
				{
					signal: requestSignal,
					onProviderStreamEvent: options?.onProviderStreamEvent,
					serviceTier: options?.serviceTier,
					grammarToolInputProperties: new Map(
						[...toolsForContext(context)].flatMap(tool => {
							const config = tool.constrainedSampling;
							const property = (tool.parameters as unknown as { required?: string[] }).required?.[0];
							return model.compat?.supportsOpenAIGrammarTools && config && config.type === "grammar" && property
								? [[tool.name, property]]
								: [];
						}),
					),
					onFirstToken: () => {
						if (!firstTokenTime) firstTokenTime = Date.now();
					},
					onOutputItemDone: item => {
						const native = structuredCloneJSON<unknown>(item) as unknown as Record<string, unknown>;
						const existing = nativeOutputItems.findIndex(value => value.id === native.id);
						if (existing >= 0) nativeOutputItems[existing] = native;
						else nativeOutputItems.push(native);
					},
				},
			);
			if (copilotPremiumRequests !== undefined) output.usage.premiumRequests = copilotPremiumRequests;

			const firstEventTimeoutError = abortTracker.getLocalAbortReason();
			if (firstEventTimeoutError) {
				throw firstEventTimeoutError;
			}
			if (abortTracker.wasCallerAbort()) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			output.providerPayload = createOpenAIResponsesHistoryPayload(model.provider, nativeOutputItems);
			if (providerSessionState) {
				providerSessionState.nativeHistoryReplayWarmed = true;
				if (model.compat?.supportsCachedReasoningUpdates && params.reasoning?.effort) {
					providerSessionState.originalReasoning = params.reasoning.effort;
					const items = params.input as unknown as Record<string, unknown>[];
					let position = 0;
					const anchors: { position: number; effort: ReasoningEffort }[] = [];
					for (const item of items) {
						if (item.type === "configuration_update")
							anchors.push({ position, effort: (item.reasoning as { effort: ReasoningEffort }).effort });
						else position++;
					}
					providerSessionState.reasoningAnchors = anchors;
					providerSessionState.activeReasoning = anchors.at(-1)?.effort ?? params.reasoning.effort;
					providerSessionState.reasoningPrefix = items
						.filter(item => item.type !== "configuration_update")
						.map(item => JSON.stringify(item));
				}
			}

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
			const firstEventTimeoutError = abortTracker.getLocalAbortReason();
			output.stopReason = abortTracker.wasCallerAbort() ? "aborted" : "error";
			output.errorMessage = firstEventTimeoutError?.message ?? (await finalizeErrorMessage(error, rawRequestDump));
			output.errorMessage = rewriteCopilotAuthError(output.errorMessage, error, model.provider);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function createClient(
	model: Model<"openai-responses">,
	context: Context,
	apiKey?: string,
	extraHeaders?: Record<string, string>,
	initiatorOverride?: MessageAttribution,
	fetch?: StreamOptions["fetch"],
): {
	client: OpenAI;
	copilotPremiumRequests: number | undefined;
	baseUrl: string | undefined;
} {
	if (!apiKey) {
		if (!$env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = $env.OPENAI_API_KEY;
	}
	const rawApiKey = apiKey;

	const headers = cloudflareGatewayHeaders(model.baseUrl, rawApiKey, {
		...(model.headers ?? {}),
		...(extraHeaders ?? {}),
	});
	let copilotPremiumRequests: number | undefined;

	let baseUrl = model.baseUrl;
	if (model.provider === "github-copilot") {
		apiKey = parseGitHubCopilotApiKey(rawApiKey).accessToken;
		const hasImages = hasCopilotVisionInput(context.messages);
		const copilot = buildCopilotDynamicHeaders({
			messages: context.messages,
			hasImages,
			premiumMultiplier: model.premiumMultiplier,
			headers,
			initiatorOverride,
		});
		Object.assign(headers, copilot.headers);
		copilotPremiumRequests = copilot.premiumRequests;
		baseUrl = resolveGitHubCopilotBaseUrl(model.baseUrl, rawApiKey) ?? model.baseUrl;
	}
	return {
		client: new OpenAI({
			apiKey,
			baseURL: baseUrl,
			fetch:
				new URL(baseUrl).hostname === "gateway.ai.cloudflare.com"
					? ((async (input, init) => {
							const headers = new Headers(init?.headers);
							headers.delete("authorization");
							headers.delete("x-api-key");
							return (fetch ?? globalThis.fetch)(input, { ...init, headers });
						}) as typeof globalThis.fetch)
					: (fetch as typeof globalThis.fetch | undefined),
			dangerouslyAllowBrowser: true,
			maxRetries: 5,
			defaultHeaders: headers,
		}),
		copilotPremiumRequests,
		baseUrl,
	};
}

export function buildParams(
	model: Model<"openai-responses">,
	context: Context,
	options: OpenAIResponsesOptions | undefined,
	providerSessionState: OpenAIResponsesProviderSessionState | undefined,
	resolvedBaseUrl?: string,
): { conversationMessages: ResponseInput; params: OpenAIResponsesSamplingParams } {
	const strictResponsesPairing =
		options?.strictResponsesPairing ??
		(isAzureOpenAIBaseUrl(model.baseUrl ?? "") || model.provider === "github-copilot");
	const conversationMessages = convertConversationMessages(
		model,
		context,
		strictResponsesPairing,
		providerSessionState,
	);
	let messages: ResponseInput = [...conversationMessages];

	if (context.systemPrompt) {
		const role = model.reasoning && supportsDeveloperRole(resolvedBaseUrl ?? model) ? "developer" : "system";
		messages.unshift({
			role,
			content: context.systemPrompt.toWellFormed(),
		});
	}

	const cacheRetention = resolveCacheRetention(options?.cacheRetention);
	const promptCacheKey = cacheRetention === "none" ? undefined : options?.sessionId;
	const hasCodexInteractionDefaults = model.defaultReasoningSummary !== undefined;
	const params: OpenAIResponsesSamplingParams = {
		model: model.id,
		input: messages,
		stream: true,
		prompt_cache_key: promptCacheKey,
		...(model.compat?.supportsExplicitPromptCacheMode
			? {
					prompt_cache_options: options?.promptCache ?? {
						mode: cacheRetention === "none" ? "explicit" : "implicit",
						ttl: "30m",
					},
				}
			: {
					prompt_cache_retention: promptCacheKey
						? getPromptCacheRetention(model.baseUrl, cacheRetention)
						: undefined,
				}),
		store: false,
	};

	if (model.truncationPolicy) {
		messages = truncateFunctionCallOutputs(
			messages as unknown as import("./openai-codex/request-transformer").InputItem[],
			model.truncationPolicy,
		) as unknown as ResponseInput;
		params.input = messages;
	}

	if (options?.maxTokens) {
		params.max_output_tokens = options?.maxTokens;
	}

	const modelCompat = (model as unknown as { compat?: Pick<OpenAICompat, "supportsTemperature"> }).compat;
	if (options?.temperature !== undefined && modelCompat?.supportsTemperature !== false) {
		params.temperature = options?.temperature;
	}
	if (options?.topP !== undefined) {
		params.top_p = options.topP;
	}
	if (options?.topK !== undefined) {
		params.top_k = options.topK;
	}
	if (options?.minP !== undefined) {
		params.min_p = options.minP;
	}
	if (options?.presencePenalty !== undefined) {
		params.presence_penalty = options.presencePenalty;
	}
	if (options?.repetitionPenalty !== undefined) {
		params.repetition_penalty = options.repetitionPenalty;
	}
	const requestedServiceTier = options?.serviceTier ?? model.defaultServiceTier;
	if (requestedServiceTier && model.serviceTiers) {
		if (!model.serviceTiers.includes(requestedServiceTier)) {
			throw new Error(
				`Service tier "${requestedServiceTier}" is unavailable for ${model.provider}/${model.id}. Supported tiers: ${model.serviceTiers.join(", ")}`,
			);
		}
		params.service_tier = requestedServiceTier;
	} else if (isSpecialServiceTier(requestedServiceTier)) {
		params.service_tier = requestedServiceTier;
	}

	const anchored = supportsToolAnchors(model, context);
	const tools = new Map((context.tools ?? []).map(tool => [tool.name, tool]));
	if (!anchored)
		for (const message of context.messages) {
			if (message.role !== "developer") continue;
			for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
			for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		}
	if (tools.size > 0 || context.tools) {
		params.tools = convertTools(
			[...tools.values()],
			model.compat?.supportsStrictMode ?? supportsStrictMode(model),
			model.compat?.supportsOpenAIGrammarTools,
		);
		const search = tools.get("search_tool_bm25");
		if (search && model.compat?.supportsToolSearch) {
			params.tools = params.tools.filter(tool => !(tool.type === "function" && tool.name === search.name));
			params.tools.push({
				type: "tool_search",
				execution: "client",
				description: search.description,
				parameters: search.parameters,
			} as OpenAITool);
		}
		if (!hasCodexInteractionDefaults && options?.toolChoice) {
			params.tool_choice = mapToOpenAIResponsesToolChoice(options.toolChoice);
		}
	}
	if (hasCodexInteractionDefaults) params.tool_choice = "auto";
	if (model.supportsParallelToolCalls !== undefined) {
		params.parallel_tool_calls = model.supportsParallelToolCalls;
	}

	if (model.reasoning) {
		// Always request encrypted reasoning content so reasoning items can be
		// replayed in multi-turn conversations when store is false (items aren't
		// persisted server-side, so we must include the full content).
		// See: https://github.com/f5-sales-demo/xcsh/issues/41
		params.include = ["reasoning.encrypted_content"];

		if (options?.reasoning || options?.reasoningSummary || hasCodexInteractionDefaults) {
			const requestedEffort = (options?.reasoning ??
				(hasCodexInteractionDefaults ? model.thinking?.defaultLevel : undefined) ??
				"medium") as ReasoningEffort;
			const supportedEffort = model.thinking
				? requireSupportedReasoningEffort(model, requestedEffort)
				: requestedEffort;
			const summary = resolveWireReasoningSummary(
				options?.reasoningSummary ?? model.defaultReasoningSummary ?? "auto",
			);
			params.reasoning = {
				effort: resolveCodexWireReasoningEffort(model.id, supportedEffort) as Exclude<ReasoningEffort, "ultra">,
				...(summary ? { summary } : {}),
			};
		} else if (model.name.startsWith("gpt-5")) {
			// Jesus Christ, see https://community.openai.com/t/need-reasoning-false-option-for-gpt-5/1351588/7
			messages.push({
				role: "developer",
				content: [
					{
						type: "input_text",
						text: "# Juice: 0 !important",
					},
				],
			});
		}
	}

	if (options?.textVerbosity || model.defaultVerbosity) {
		params.text = { verbosity: options?.textVerbosity ?? model.defaultVerbosity ?? "low" };
	}
	if (hasCodexInteractionDefaults) {
		params.client_metadata = normalizeClientMetadata(options?.metadata);
	}

	if (model.compat?.supportsCachedReasoningUpdates && providerSessionState && params.reasoning?.effort) {
		const prefix = providerSessionState.reasoningPrefix;
		const samePrefix = !prefix || prefix.every((item, index) => JSON.stringify(messages[index]) === item);
		const original = samePrefix ? providerSessionState.originalReasoning : undefined;
		if (original) {
			const requested = params.reasoning.effort;
			const anchors = [...(providerSessionState.reasoningAnchors ?? [])];
			if (requested !== (providerSessionState.activeReasoning ?? original))
				anchors.push({ position: messages.length, effort: requested });
			for (const [offset, anchor] of anchors.entries())
				messages.splice(anchor.position + offset, 0, {
					type: "configuration_update",
					reasoning: { effort: anchor.effort },
				} as unknown as ResponseInput[number]);
			params.reasoning.effort = original as Exclude<ReasoningEffort, "ultra">;
		}
	}
	return { conversationMessages, params };
}

function isAzureOpenAIBaseUrl(baseUrl: string): boolean {
	return baseUrl.includes(".openai.azure.com") || baseUrl.includes("azure.com/openai");
}

function supportsStrictMode(model: Model<"openai-responses">): boolean {
	if (model.compat?.supportsStrictMode !== undefined) return model.compat.supportsStrictMode;
	if (model.provider === "openai" || model.provider === "azure" || model.provider === "github-copilot") return true;

	const baseUrl = model.baseUrl.toLowerCase();
	return (
		baseUrl.includes("api.openai.com") ||
		baseUrl.includes(".openai.azure.com") ||
		baseUrl.includes("models.inference.ai.azure.com")
	);
}

export function supportsDeveloperRole(modelOrBaseUrl: Pick<Model, "provider" | "baseUrl"> | string): boolean {
	const baseUrl =
		typeof modelOrBaseUrl === "string" ? modelOrBaseUrl.toLowerCase() : (modelOrBaseUrl.baseUrl ?? "").toLowerCase();
	return (
		baseUrl.includes("api.openai.com") ||
		baseUrl.includes(".openai.azure.com") ||
		baseUrl.includes("azure.com/openai") ||
		baseUrl.includes("models.inference.ai.azure.com") ||
		baseUrl.includes("githubcopilot.com") ||
		baseUrl.includes("copilot-api.")
	);
}

export function convertConversationMessages(
	model: Model<"openai-responses">,
	context: Context,
	strictResponsesPairing: boolean,
	providerSessionState: OpenAIResponsesProviderSessionState | undefined,
): ResponseInput {
	const messages: ResponseInput = [];
	let knownCallIds = new Set<string>();
	const shouldReplayNativeHistory = canReplayOpenAIResponsesNativeHistory(providerSessionState);
	const transformedMessages = transformMessages(context.messages, model, normalizeResponsesToolCallIdForTransform);

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user" || msg.role === "developer") {
			const providerPayload = (msg as { providerPayload?: AssistantMessage["providerPayload"] }).providerPayload;
			const historyItems = getOpenAIResponsesHistoryItems(providerPayload, model.provider);
			const shouldReplayPayloadItems =
				shouldReplayNativeHistory ||
				(historyItems?.some(item => {
					if (!item || typeof item !== "object") return false;
					const candidate = item as { type?: unknown };
					return candidate.type === "compaction" || candidate.type === "compaction_summary";
				}) ??
					false);
			if (historyItems && shouldReplayPayloadItems) {
				messages.push(...sanitizeOpenAIResponsesHistoryItemsForReplay(historyItems));
				knownCallIds = collectKnownCallIds(messages);
				msgIndex++;
				continue;
			}
			const content = convertResponsesInputContent(msg.content, model.input.includes("image"));
			if (!content) continue;
			messages.push({ role: msg.role, content });
			if (msg.role === "developer" && msg.toolsAdded?.length && supportsToolAnchors(model, context)) {
				const compat = model.compat;
				const tools = convertTools(
					msg.toolsAdded,
					supportsStrictMode(model),
					model.compat?.supportsOpenAIGrammarTools,
				);
				if (compat?.supportsAdditionalTools)
					messages.push({
						type: "additional_tools",
						role: "developer",
						tools,
					} as unknown as ResponseInput[number]);
				else if (compat?.supportsToolSearch) {
					const callId = `xcsh_tool_load_${Bun.hash(JSON.stringify([msg.timestamp, tools])).toString(36)}`;
					messages.push({
						type: "tool_search_call",
						call_id: callId,
						execution: "client",
						status: "completed",
						arguments: { query: msg.toolsAdded.map(tool => tool.name).join(" "), limit: tools.length },
					} as unknown as ResponseInput[number]);
					messages.push({
						type: "tool_search_output",
						call_id: callId,
						execution: "client",
						status: "completed",
						tools,
					} as unknown as ResponseInput[number]);
				}
			}
		} else if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			const providerPayload = shouldReplayNativeHistory
				? getOpenAIResponsesHistoryPayload(assistantMsg.providerPayload, model.provider, assistantMsg.provider)
				: undefined;
			const historyItems = providerPayload?.items;
			if (historyItems) {
				const sanitizedHistoryItems = sanitizeOpenAIResponsesHistoryItemsForReplay(historyItems);
				if (providerPayload?.dt) {
					messages.push(...sanitizedHistoryItems);
				} else {
					messages.splice(0, messages.length, ...sanitizedHistoryItems);
				}
				knownCallIds = collectKnownCallIds(messages);
				msgIndex++;
				continue;
			}

			const outputItems = convertResponsesAssistantMessage(
				assistantMsg,
				model,
				msgIndex,
				knownCallIds,
				shouldReplayNativeHistory,
			);
			if (outputItems.length === 0) continue;
			messages.push(...outputItems);
		} else if (msg.role === "toolResult") {
			if (msg.toolSearch && model.compat?.supportsToolSearch) {
				messages.push({
					type: "tool_search_output",
					call_id: msg.toolCallId.split("|")[0],
					execution: "client",
					status: "completed",
					tools: convertTools(
						msg.tools ?? [],
						supportsStrictMode(model),
						model.compat?.supportsOpenAIGrammarTools,
					).map(tool => ({ ...tool, defer_loading: true })),
				} as unknown as ResponseInput[number]);
			} else appendResponsesToolResultMessages(messages, msg, model, strictResponsesPairing, knownCallIds);
		}
		msgIndex++;
	}

	return messages;
}

export function convertTools(tools: Tool[], strictMode: boolean, grammar = false): OpenAITool[] {
	return tools.map(tool => {
		if (grammar && tool.constrainedSampling && tool.constrainedSampling.type === "grammar") {
			const variants = tool.constrainedSampling.variants;
			const format = variants.openai_lark ? "lark" : "regex";
			const definition = variants.openai_lark ?? variants.openai_regex;
			const schema = tool.parameters as unknown as {
				required?: string[];
				properties?: Record<string, { type?: string }>;
			};
			const property = schema.required?.[0];
			if (
				!definition ||
				schema.required?.length !== 1 ||
				!property ||
				schema.properties?.[property]?.type !== "string"
			)
				throw new Error(`Invalid grammar tool ${tool.name}`);
			return {
				type: "custom",
				name: tool.name,
				description: tool.description,
				format: { type: "grammar", syntax: format, definition },
			} as OpenAITool;
		}
		if (
			tool.constrainedSampling &&
			tool.constrainedSampling.type === "json_schema" &&
			tool.constrainedSampling.strict === "require" &&
			!strictMode
		)
			throw new Error(`Strict tools unsupported for ${tool.name}`);
		const strict =
			!NO_STRICT &&
			strictMode &&
			(tool.constrainedSampling && tool.constrainedSampling.type === "json_schema" ? true : tool.strict !== false);
		const baseParameters = tool.parameters as unknown as Record<string, unknown>;
		const { schema: parameters, strict: effectiveStrict } = adaptSchemaForStrict(baseParameters, strict);
		return {
			type: "function",
			name: tool.name,
			description: tool.description || "",
			parameters,
			...(effectiveStrict ? { strict: true } : tool.strict === false ? { strict: false } : {}),
		} as OpenAITool;
	});
}

function toolsForContext(context: Context): Tool[] {
	return [
		...(context.tools ?? []),
		...context.messages.flatMap(message => (message.role === "developer" ? (message.toolsAdded ?? []) : [])),
	];
}

function supportsToolAnchors(model: Model<"openai-responses">, context: Context): boolean {
	if (!model.compat?.supportsAdditionalTools && !model.compat?.supportsToolSearch) return false;
	const declared = new Set((context.tools ?? []).map(tool => tool.name));
	for (const message of context.messages) {
		if (message.role !== "developer") continue;
		if (message.toolsRemoved?.length) return false;
		for (const tool of message.toolsAdded ?? []) {
			if (declared.has(tool.name)) return false;
			declared.add(tool.name);
		}
	}
	return true;
}
