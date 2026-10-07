import type { TSchema } from "@sinclair/typebox";
import type { BedrockOptions } from "./providers/amazon-bedrock";
import type { AnthropicOptions } from "./providers/anthropic";
import type { AzureOpenAIResponsesOptions } from "./providers/azure-openai-responses";
import type { CursorOptions } from "./providers/cursor";
import type {
	DeleteArgs,
	DeleteResult,
	DiagnosticsArgs,
	DiagnosticsResult,
	GrepArgs,
	GrepResult,
	LsArgs,
	LsResult,
	ReadArgs,
	ReadResult,
	ShellArgs,
	ShellResult,
	WriteArgs,
	WriteResult,
} from "./providers/cursor/gen/agent_pb";
import type { GoogleOptions } from "./providers/google";
import type { GoogleGeminiCliOptions } from "./providers/google-gemini-cli";
import type { GoogleVertexOptions } from "./providers/google-vertex";
import type { OpenAICodexResponsesOptions } from "./providers/openai-codex-responses";
import type { OpenAICompletionsOptions } from "./providers/openai-completions";
import type { OpenAIResponsesOptions } from "./providers/openai-responses";
import type { AssistantMessageEventStream } from "./utils/event-stream";

export type { AssistantMessageEventStream } from "./utils/event-stream";

/** Internal credential sentinel that keeps keyless providers selectable without sending authentication. */
export const NO_AUTH_API_KEY = "N/A";

export type KnownApi =
	| "pi-messages"
	| "mistral-conversations"
	| "openai-completions"
	| "openai-responses"
	| "openai-codex-responses"
	| "azure-openai-responses"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-gemini-cli"
	| "google-vertex"
	| "cursor-agent";
export type Api = KnownApi | (string & {});
export interface ApiOptionsMap {
	"pi-messages": import("./providers/pi-messages").PiMessagesOptions;
	"mistral-conversations": import("./providers/mistral-conversations").MistralOptions;
	"anthropic-messages": AnthropicOptions;
	"bedrock-converse-stream": BedrockOptions;
	"openai-completions": OpenAICompletionsOptions;
	"openai-responses": OpenAIResponsesOptions;
	"openai-codex-responses": OpenAICodexResponsesOptions;
	"azure-openai-responses": AzureOpenAIResponsesOptions;
	"google-generative-ai": GoogleOptions;
	"google-gemini-cli": GoogleGeminiCliOptions;
	"google-vertex": GoogleVertexOptions;
	"cursor-agent": CursorOptions;
}
// Compile-time exhaustiveness check - this will fail if ApiOptionsMap doesn't have all KnownApi keys
type _CheckExhaustive =
	ApiOptionsMap extends Record<KnownApi, StreamOptions>
		? Record<KnownApi, StreamOptions> extends ApiOptionsMap
			? true
			: ["ApiOptionsMap is missing some KnownApi values", Exclude<KnownApi, keyof ApiOptionsMap>]
		: ["ApiOptionsMap doesn't extend Record<KnownApi, StreamOptions>"];
const _exhaustive: _CheckExhaustive = true;
export type OptionsForApi<TApi extends Api> =
	| StreamOptions
	| (TApi extends keyof ApiOptionsMap ? ApiOptionsMap[TApi] : never);

/** Canonical thinking transport used by a model. */
export type ThinkingControlMode =
	| "effort"
	| "budget"
	| "google-level"
	| "anthropic-adaptive"
	| "anthropic-budget-effort";

/** Per-model thinking capabilities used to clamp and map user-facing effort levels. */
export interface ReasoningEffortPreset {
	effort: ReasoningEffort;
	description: string;
}

export interface ThinkingConfig {
	/** Ordered, explicit provider-supported choices and their service descriptions. */
	supportedLevels: ReasoningEffortPreset[];
	/** Exact provider default when the request omits reasoning effort. */
	defaultLevel: ReasoningEffort;
	/** Provider-specific transport used to encode the selected effort. */
	mode: ThinkingControlMode;
}

export type KnownProvider =
	| "typesafe"
	| "cloudflare-workers-ai"
	| "radius"
	| "ant-ling"
	| "baseten"
	| "deepseek"
	| "fireworks"
	| "meta"
	| "minimax-cn"
	| "moonshotai-cn"
	| "zai-coding-cn"
	| "qwen-token-plan"
	| "qwen-token-plan-cn"
	| "qwen-token-plan-individual"
	| "xiaomi-token-plan-ams"
	| "xiaomi-token-plan-cn"
	| "xiaomi-token-plan-sgp"
	| "alibaba-coding-plan"
	| "amazon-bedrock"
	| "anthropic"
	| "google"
	| "google-gemini-cli"
	| "google-antigravity"
	| "google-vertex"
	| "openai"
	| "openai-codex"
	| "kimi-code"
	| "minimax-code"
	| "minimax-code-cn"
	| "github-copilot"
	| "gitlab-duo"
	| "cursor"
	| "xai"
	| "groq"
	| "cerebras"
	| "openrouter"
	| "kilo"
	| "vercel-ai-gateway"
	| "zai"
	| "mistral"
	| "minimax"
	| "opencode-go"
	| "opencode-zen"
	| "synthetic"
	| "cloudflare-ai-gateway"
	| "huggingface"
	| "litellm"
	| "moonshot"
	| "nvidia"
	| "nanogpt"
	| "ollama"
	| "qianfan"
	| "qwen-portal"
	| "together"
	| "venice"
	| "vllm"
	| "xiaomi"
	| "zenmux"
	| "lm-studio";
export type Provider = KnownProvider | string;

import type { Effort, ReasoningEffort } from "./model-thinking";

/** Token budgets for each thinking level (token-based providers only) */
export type ThinkingBudgets = { [key in Effort]?: number };

export type MessageAttribution = "user" | "agent";

export type ToolChoice =
	| "auto"
	| "none"
	| "any"
	| "required"
	| { type: "function"; name: string }
	| { type: "function"; function: { name: string } }
	| { type: "tool"; name: string };

// Base options all providers share
export type CacheRetention = "none" | "short" | "long";

/** OpenAI service tier for processing priority. Only applies to OpenAI-compatible APIs. */
export type ServiceTier = "auto" | "default" | "flex" | "scale" | "priority";

export function isSpecialServiceTier(serviceTier?: ServiceTier | null): serviceTier is "flex" | "scale" | "priority" {
	return serviceTier === "flex" || serviceTier === "scale" || serviceTier === "priority";
}

export interface LiveSteering {
	wait(signal: AbortSignal): Promise<void>;
	claim(signal: AbortSignal): Promise<LiveSteerClaim | undefined>;
}
export interface LiveSteerClaim {
	readonly messages: readonly UserMessage[];
	accept(): void;
	reject(): void;
}

export interface ProviderSessionState {
	close(): void;
}

export interface DeferredHandle {
	/** Conversion metadata needed when polling on a fresh process. */
	data?: JsonValue;
	provider: string;
	modelId: string;
	api: string;
	baseUrl: string;
	id: string;
	expiresAt?: number;
	pollAfterMs?: number;
}

export interface StreamOptions {
	/** Cloudflare account used to resolve endpoint placeholders before dispatch. */
	accountId?: string;
	gatewayId?: string;
	onProviderStreamEvent?: (event: unknown, model: Model) => void | Promise<void>;
	timeoutMs?: number;
	onResponse?: (response: { status: number; headers: Record<string, string> }, model: Model) => void | Promise<void>;
	liveSteering?: LiveSteering;
	fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	maxRetries?: number;
	promptCache?: { mode: "implicit" | "explicit"; ttl?: "30m" };
	temperature?: number;
	topP?: number;
	topK?: number;
	minP?: number;
	presencePenalty?: number;
	repetitionPenalty?: number;
	maxTokens?: number;
	signal?: AbortSignal;
	apiKey?: string;
	cacheRetention?: CacheRetention;
	/**
	 * Additional headers to include in provider requests.
	 * These are merged on top of model-defined headers.
	 */
	headers?: Record<string, string>;
	/**
	 * Optional explicit request attribution override for providers that support it.
	 */
	initiatorOverride?: MessageAttribution;
	/**
	 * Maximum delay in milliseconds to wait for a retry when the server requests a long wait.
	 * If the server's requested delay exceeds this value, the request fails immediately
	 * with an error containing the requested delay, allowing higher-level retry logic
	 * to handle it with user visibility.
	 * Default: 60000 (60 seconds). Set to 0 to disable the cap.
	 */
	maxRetryDelayMs?: number;
	/**
	 * Optional metadata to include in API requests.
	 * Providers extract the fields they understand and ignore the rest.
	 * For example, Anthropic uses `user_id` for abuse tracking and rate limiting.
	 */
	metadata?: Record<string, unknown>;
	/**
	 * Optional session identifier for providers that support session-based caching.
	 * Providers can use this to enable prompt caching, request routing, or other
	 * session-aware features. Ignored by providers that don't support it.
	 */
	sessionId?: string;
	/**
	 * Provider-scoped mutable state store for this agent session.
	 * Providers can use this to persist transport/session state between turns.
	 */
	providerSessionState?: Map<string, ProviderSessionState>;
	/**
	 * Optional callback for inspecting or replacing provider payloads before sending.
	 * Return undefined to keep the payload unchanged.
	 */
	onPayload?: (payload: unknown, model?: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
	/**
	 * Optional override for the first streamed event watchdog in milliseconds.
	 * Set to 0 to disable the first-event watchdog for this request.
	 */
	streamFirstEventTimeoutMs?: number;
	/** Cursor generic execution handlers (cursor-agent only). */
	execHandlers?: CursorExecHandlers;
}

// Unified options with reasoning passed to streamSimple() and completeSimple()
export interface SimpleStreamOptions extends StreamOptions {
	reasoningSummary?: "none" | "auto" | "concise" | "detailed";
	/** Confirmed Google Cloud project for the Corporate Vertex transport. */
	project?: string;
	/** Google Cloud location for the Corporate Vertex transport. */
	location?: string;
	reasoning?: Effort;
	/** Custom token budgets for thinking levels (token-based providers only) */
	thinkingBudgets?: ThinkingBudgets;
	/** Cursor exec handlers for local tool execution */
	cursorExecHandlers?: CursorExecHandlers;
	/** Hook to handle tool results from Cursor exec */
	cursorOnToolResult?: CursorToolResultHandler;
	/** Optional tool choice override for compatible providers */
	toolChoice?: ToolChoice;
	/** OpenAI service tier for processing priority/cost control. Ignored by non-OpenAI providers. */
	serviceTier?: ServiceTier;
	/** API format for Kimi Code provider: "openai" or "anthropic" (default: "anthropic") */
	kimiApiFormat?: "openai" | "anthropic";
	/** API format for Synthetic provider: "openai" or "anthropic" (default: "openai") */
	syntheticApiFormat?: "openai" | "anthropic";
	/** Hint that websocket transport should be preferred when supported by the provider implementation. */
	preferWebsockets?: boolean;
}

// Generic StreamFunction with typed options
export type StreamFunction<TApi extends Api> = (
	model: Model<TApi>,
	context: Context,
	options: OptionsForApi<TApi>,
) => AssistantMessageEventStream;

export type AssistantMessagePhase = "commentary" | "final_answer";

export interface TextSignatureV1 {
	v: 1;
	id: string;
	phase?: AssistantMessagePhase;
}

/**
 * A structured citation annotating a span of assistant text, produced by a provider's
 * SERVER-SIDE search tool (Anthropic `citations_delta` → `web_search_result_location`).
 *
 * Carries the source title/url so hosts can render precise "Sources" chips instead of
 * regex-scraping URLs out of the prose.
 */
export interface WebCitation {
	type: "web_search_result_location";
	url: string;
	title?: string;
	/** The span of source material the assistant drew on. */
	citedText?: string;
	/**
	 * Opaque provider index for the cited result. Retained for fidelity only — it is never
	 * re-sent, because echoing a provider's encrypted citation fields back on a later turn
	 * must be byte-exact or the request is rejected.
	 */
	encryptedIndex?: string;
}

export interface TextContent {
	type: "text";
	promptCacheBreakpoint?: { mode: "explicit" };
	text: string;
	/** Semantic role supplied by Responses. Absence has final-answer semantics. */
	phase?: AssistantMessagePhase;
	textSignature?: string; // e.g., for OpenAI responses, message metadata (legacy id string or TextSignatureV1 JSON)
	/** Structured citations for this span, when the provider ran a server-side search. */
	citations?: WebCitation[];
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string; // e.g., for OpenAI responses, the reasoning item ID
}

export interface RedactedThinkingContent {
	type: "redactedThinking";
	data: string;
}

export interface ImageContent {
	type: "image";
	promptCacheBreakpoint?: { mode: "explicit" };
	data: string; // base64 encoded image data
	mimeType: string; // e.g., "image/jpeg", "image/png"
}

export interface ToolCall {
	/** Client-executed Responses tool discovery, dispatched through the registered search tool. */
	toolSearch?: boolean;
	namespace?: string;
	customInputProperty?: string;
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
	thoughtSignature?: string; // Google-specific: opaque signature for reusing thought context
	intent?: string; // Harness-level intent metadata extracted from traced tool arguments
}

export interface Usage {
	/** Distinguishes token reporting from API dollar estimates. */
	billing?: "api" | "subscription" | "internal";
	/** False when the catalog rate is dynamic or unavailable. */
	costKnown?: boolean;
	/** Provider-reported subset of output tokens; never added to output a second time. */
	reasoningTokens?: number;
	/** Provider-reported cache writes before normalization. */
	cacheWriteTokens?: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	premiumRequests?: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface OpenAIResponsesHistoryPayload {
	type: "openaiResponsesHistory";
	provider?: string;
	dt?: boolean;
	items: Array<Record<string, unknown>>;
}

export type ProviderPayload = OpenAIResponsesHistoryPayload;

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	/** True if the message was injected by the system (e.g., auto-continue). */
	synthetic?: boolean;
	/** Who initiated this message for billing/attribution semantics. */
	attribution?: MessageAttribution;
	/** Provider-specific opaque payload used to reconstruct transport-native history. */
	providerPayload?: ProviderPayload;
	timestamp: number; // Unix timestamp in milliseconds
}

export interface DeveloperMessage {
	toolsAdded?: Tool[];
	toolsRemoved?: { name: string }[];
	role: "developer";
	content: string | (TextContent | ImageContent)[];
	/** Who initiated this message for billing/attribution semantics. */
	attribution?: MessageAttribution;
	/** Provider-specific opaque payload used to reconstruct transport-native history. */
	providerPayload?: ProviderPayload;
	timestamp: number; // Unix timestamp in milliseconds
}

export interface AssistantMessage {
	/** Completed content retained after a typed transport interruption. */
	interruption?: {
		transport: "sse" | "websocket";
		classification: "socket_closed" | "premature_eof" | "idle_timeout";
		providerRetriesConsumed: number;
		toolChoiceServed?: boolean;
		completedContentIndices: number[];
	};
	/** A queued background request; poll using the same provider route. */
	deferred?: DeferredHandle;
	providerRewrite?: {
		policyId: string;
		policyVersion: number;
		changed: boolean;
		tokenCountChange: number;
		messageCountChange: number;
		systemPromptChanged: boolean;
	};
	providerThinkingLevel?: string;
	role: "assistant";
	content: (TextContent | ThinkingContent | RedactedThinkingContent | ToolCall)[];
	api: Api;
	provider: Provider;
	model: string;
	/**
	 * Transport evidence reported by the server. Unlike `provider` and `model`,
	 * these optional fields must never be populated from the request.
	 */
	responseAttribution?: {
		requestedModel: string;
		responseModel?: string;
		responseModelSource?: "response-body" | "response-header";
		upstreamProvider?: string;
		upstreamProviderSource?: "response-body" | "response-header";
	};
	responseId?: string; // Provider-specific response/message identifier when the upstream API exposes one
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	/** Sanitized provider error identifier used for internal lifecycle classification. */
	providerFailureCode?: string;
	/** Provider-native completion reason retained for diagnostics and transport-specific recovery. */
	rawStopReason?: string;
	/** Provider-specific opaque payload used to reconstruct transport-native history. */
	providerPayload?: ProviderPayload;
	timestamp: number; // Unix timestamp in milliseconds
	duration?: number; // Request duration in milliseconds
	ttft?: number; // Time to first token in milliseconds
}

export interface ToolResultMessage<TDetails = any> {
	customTool?: boolean;
	toolSearch?: boolean;
	/** Trusted definitions activated by client tool discovery. */
	tools?: Tool[];
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[]; // Supports text and images
	details?: TDetails;
	isError: boolean;
	/** Set when the tool completed normally but produced a degraded or empty result. */
	isWarning?: boolean;
	/** Who initiated this message for billing/attribution semantics. */
	attribution?: MessageAttribution;
	/** Timestamp when output was pruned (ms since epoch). Undefined if unpruned. */
	prunedAt?: number;
	timestamp: number; // Unix timestamp in milliseconds
}

export type Message = UserMessage | DeveloperMessage | AssistantMessage | ToolResultMessage;

export type CursorExecHandlerResult<T> = { result: T; toolResult?: ToolResultMessage } | T | ToolResultMessage;

export type CursorToolResultHandler = (
	result: ToolResultMessage,
) => ToolResultMessage | undefined | Promise<ToolResultMessage | undefined>;

/** A generic tool request transported by the Cursor agent protocol. */
export interface CursorToolCall {
	name: string;
	providerIdentifier: string;
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	rawArgs: Record<string, Uint8Array>;
}

export interface CursorShellStreamCallbacks {
	onStdout(data: string): void;
	onStderr(data: string): void;
}

export interface CursorExecHandlers {
	read?: (args: ReadArgs) => Promise<CursorExecHandlerResult<ReadResult>>;
	ls?: (args: LsArgs) => Promise<CursorExecHandlerResult<LsResult>>;
	grep?: (args: GrepArgs) => Promise<CursorExecHandlerResult<GrepResult>>;
	write?: (args: WriteArgs) => Promise<CursorExecHandlerResult<WriteResult>>;
	delete?: (args: DeleteArgs) => Promise<CursorExecHandlerResult<DeleteResult>>;
	shell?: (args: ShellArgs) => Promise<CursorExecHandlerResult<ShellResult>>;
	shellStream?: (
		args: ShellArgs,
		callbacks: CursorShellStreamCallbacks,
	) => Promise<CursorExecHandlerResult<ShellResult>>;
	diagnostics?: (args: DiagnosticsArgs) => Promise<CursorExecHandlerResult<DiagnosticsResult>>;
	tool?: (call: CursorToolCall) => Promise<CursorExecHandlerResult<unknown>>;
	onToolResult?: CursorToolResultHandler;
}

export interface Tool<TParameters extends TSchema = TSchema> {
	constrainedSampling?:
		| false
		| { type: "json_schema"; strict: "prefer" | "require" }
		| { type: "grammar"; variants: Partial<Record<"openai_lark" | "openai_regex", string>> };

	name: string;
	description: string;
	parameters: TParameters;
	/** If true, tool is strictly typed and validated against the parameters schema before execution */
	strict?: boolean;
}

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

export type AssistantMessageEvent =
	| { type: "start"; contentIndex?: undefined; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; phase?: AssistantMessagePhase; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| {
			type: "text_end";
			contentIndex: number;
			content: string;
			phase?: AssistantMessagePhase;
			partial: AssistantMessage;
	  }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	/**
	 * A provider-SIDE tool (e.g. Anthropic's built-in web search) started running.
	 *
	 * Purely a progress signal so hosts can show a live activity row — the provider executes
	 * these itself, so unlike `toolcall_*` there is nothing for the agent loop to dispatch and
	 * no content block is added to the message.
	 */
	| {
			type: "server_tool_start";
			contentIndex?: undefined;
			toolName: string;
			toolId: string;
			/** The search query, when the provider streamed one. */
			query?: string;
			partial: AssistantMessage;
	  }
	/** A provider-side tool finished: either it returned results, or it failed. */
	| {
			type: "server_tool_end";
			contentIndex?: undefined;
			toolName: string;
			toolId: string;
			resultCount?: number;
			errorCode?: string;
			partial: AssistantMessage;
	  }
	| {
			type: "done";
			contentIndex?: undefined;
			reason: Extract<StopReason, "stop" | "length" | "toolUse">;
			message: AssistantMessage;
	  }
	| {
			type: "error";
			contentIndex?: undefined;
			reason: Extract<StopReason, "aborted" | "error">;
			error: AssistantMessage;
	  };

/**
 * Compatibility settings for openai-completions API.
 * Use this to override URL-based auto-detection for custom providers.
 */
export interface OpenAICompat {
	/** Anthropic native transcript controls. Opt in only for a qualified route. */
	supportsMidConvoSystemMessages?: boolean;
	supportsMidConvoToolChanges?: boolean;
	/** Whether the provider supports the `store` field. Default: auto-detected from URL. */
	supportsStore?: boolean;
	/** Whether the model accepts an explicit `temperature` parameter. Default: true. */
	supportsTemperature?: boolean;
	/** Whether the provider supports the `developer` role (vs `system`). Default: auto-detected from URL. */
	supportsDeveloperRole?: boolean;
	/** Whether the provider supports `reasoning_effort`. Default: auto-detected from URL. */
	supportsReasoningEffort?: boolean;
	/** Optional mapping from pi-ai reasoning levels to provider/model-specific `reasoning_effort` values. */
	reasoningEffortMap?: Partial<Record<Effort, string>>;
	/** Whether the provider supports `stream_options: { include_usage: true }` for token usage in streaming responses. Default: true. */
	supportsUsageInStreaming?: boolean;
	/** Routes without finish_reason infer toolUse from completed calls at stream end. */
	supportsFinishReason?: boolean;
	/** Which field to use for max tokens. Default: auto-detected from URL. */
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	/** Whether tool results require the `name` field. Default: auto-detected from URL. */
	requiresToolResultName?: boolean;
	/** Whether a user message after tool results requires an assistant message in between. Default: auto-detected from URL. */
	requiresAssistantAfterToolResult?: boolean;
	/** Whether thinking blocks must be converted to text blocks with <thinking> delimiters. Default: auto-detected from URL. */
	requiresThinkingAsText?: boolean;
	/** Whether tool call IDs must be normalized to Mistral format (exactly 9 alphanumeric chars). Default: auto-detected from URL. */
	requiresMistralToolIds?: boolean;
	/** Format for reasoning/thinking parameter. "openai" uses reasoning_effort, "openrouter" uses reasoning: { effort }, "zai" uses thinking: { type: "enabled" }, "qwen" uses top-level enable_thinking, and "qwen-chat-template" uses chat_template_kwargs.enable_thinking. Default: "openai". */
	thinkingFormat?:
		| "openai"
		| "openrouter"
		| "zai"
		| "qwen"
		| "qwen-chat-template"
		| "ant-ling"
		| "baseten"
		| "deepseek"
		| "together"
		| "chat-template"
		| "string-thinking";
	chatTemplateKwargs?: Record<string, ChatTemplateValue>;
	chatTemplateArgs?: Record<string, ChatTemplateValue>;
	thinkingTokenBudgetField?: "thinking_token_budget" | "thinking_budget" | "thinking_budget_tokens";
	supportsThinkingTokenBudget?: boolean;
	sendSessionAffinityHeaders?: boolean;
	/** Anthropic-compatible gateway controls. */
	allowEmptySignature?: boolean;
	supportsCacheControlOnTools?: boolean;
	forceAdaptiveThinking?: boolean;
	supportsOpenAIGrammarTools?: boolean;
	/** Which reasoning content field to emit on assistant messages. Default: auto-detected. */
	reasoningContentField?: "reasoning_content" | "reasoning" | "reasoning_text";
	/** Whether assistant tool-call messages must include reasoning content. Default: false. */
	requiresReasoningContentForToolCalls?: boolean;
	/** Whether assistant tool-call messages must include non-empty content. Default: false. */
	requiresAssistantContentForToolCalls?: boolean;
	/** Whether the provider supports the `tool_choice` parameter. Default: true. */
	supportsToolChoice?: boolean;
	/** OpenRouter-specific routing preferences. Only used when baseUrl points to OpenRouter. */
	openRouterRouting?: OpenRouterRouting;
	/** Vercel AI Gateway routing preferences. Only used when baseUrl points to Vercel AI Gateway. */
	vercelGatewayRouting?: VercelGatewayRouting;
	/** Extra fields to include in request body (e.g. gateway routing hints for OpenClaw-style proxies). */
	extraBody?: Record<string, unknown>;
	/** Whether the provider supports the `strict` field in tool definitions. Default: auto-detected per provider/baseUrl (conservative for unknown providers). */
	supportsStrictMode?: boolean;
	/** Whether tool schemas must be sent either all strict or all non-strict. Undefined keeps the existing per-tool mixed behavior. */
	toolStrictMode?: "all_strict" | "none";
}

/**
 * OpenRouter provider routing preferences.
 * Controls which upstream providers OpenRouter routes requests to.
 * @see https://openrouter.ai/docs/provider-routing
 */
export interface OpenRouterRouting {
	/** List of provider slugs to exclusively use for this request (e.g., ["amazon-bedrock", "anthropic"]). */
	only?: string[];
	/** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
	order?: string[];
}

/** Scalar values or substitutions resolved from the request's reasoning controls. */
export type ChatTemplateValue =
	| string
	| number
	| boolean
	| null
	| {
			$var: "thinking.enabled" | "thinking.effort" | "thinking.budget";
			omitWhenOff?: boolean;
	  };

/**
 * Vercel AI Gateway routing preferences.
 * Controls which upstream providers the gateway routes requests to.
 * @see https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 */
export interface VercelGatewayRouting {
	/** List of provider slugs to exclusively use for this request (e.g., ["bedrock", "anthropic"]). */
	only?: string[];
	/** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
	order?: string[];
}

// Model interface for the unified model system
export interface Model<TApi extends Api = any> {
	/** Catalog-supported model-facing tools; absence does not imply support. */
	experimentalSupportedTools?: string[];
	/** Catalog overrides for async question guidance and JSON parameters. */
	modelMessages?: {
		requestUserInputAsyncDescription?: string;
		requestUserInputAsyncParameters?: string;
	};
	type?: "chat";
	id: string;
	name: string;
	api: TApi;
	provider: Provider;
	baseUrl: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: ModelCost;
	/** Premium Copilot requests charged per user-initiated request (defaults to 1). */
	premiumMultiplier?: number;
	contextWindow: number;
	/** Maximum route input independently of the total context and output limit. */
	maxInputTokens?: number;
	maxTokens: number;
	/** Largest context accepted by the Codex interaction contract. */
	maxContextWindow?: number;
	/** Live provider-advertised input limit, retained independently from the selected tier. */
	providerContextWindow?: number;
	/** Percentage of the selected context window available to request input. */
	effectiveContextWindowPercent?: number;
	/** Resolved usable input budget for the selected context tier. */
	effectiveContextWindow?: number;
	/** Percentage of the selected context window that triggers automatic compaction. */
	autoCompactThresholdPercent?: number;
	/** Resolved automatic-compaction threshold for the selected context tier. */
	autoCompactTokenLimit?: number;
	defaultReasoningSummary?: "none" | "auto" | "concise" | "detailed";
	defaultVerbosity?: "low" | "medium" | "high";
	serviceTiers?: ServiceTier[];
	defaultServiceTier?: ServiceTier;
	truncationPolicy?: { mode: "tokens" | "bytes"; limit: number };
	supportsParallelToolCalls?: boolean;
	headers?: Record<string, string>;
	/**
	 * Extra anthropic-beta feature flags to send for this model (anthropic-messages API only).
	 * Composed with request-level betas and interleaved-thinking rather than replacing them.
	 * Example: ["context-1m-2025-08-07"] to opt a model into the 1M context window.
	 */
	betas?: string[];
	/** Hint that websocket transport should be preferred when supported by the provider implementation. */
	preferWebsockets?: boolean;
	/** Preferred model to switch to when context promotion is triggered (model id or provider/id). */
	contextPromotionTarget?: string;
	/** Provider-assigned priority value (lower = higher priority). */
	priority?: number;
	/** Service-provided summary shown in model selection UI. */
	description?: string;
	/** Service-provided picker visibility. */
	visibility?: "list" | "hide" | "none";
	/** Model maker, distinct from the account/access provider. */
	publisher?: string;
	/** Human-readable model family used for catalog grouping. */
	family?: string;
	/** Human-readable model tier within a family. */
	tier?: string;
	/** Canonical thinking capability metadata for this model. */
	thinking?: ThinkingConfig;
	/** Provider-specific request compatibility overrides. */
	compat?: TApi extends "openai-completions" | "anthropic-messages"
		? OpenAICompat
		: TApi extends "openai-responses" | "openai-codex-responses" | "azure-openai-responses"
			? OpenAIResponsesCompat
			: never;
}

export interface ModelCostRates {
	input: number; // $/million tokens
	output: number; // $/million tokens
	cacheRead: number; // $/million tokens
	cacheWrite: number; // $/million tokens
}

export interface ModelCostTier extends ModelCostRates {
	/** Use this tier for requests whose total input usage exceeds this token count. */
	inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
	/** False when a routed model advertises dynamic pricing rather than a numeric rate. */
	pricingKnown?: boolean;
	/** Request-wide pricing tiers. The highest matching input threshold applies to the full request. */
	tiers?: ModelCostTier[];
}

export interface OpenAIResponsesCompat extends OpenAICompat {
	supportsWebSocketSteering?: boolean;
	supportsCachedReasoningUpdates?: boolean;
	/** Whether the provider supports the `developer` role (vs `system`). Default: true. */
	supportsDeveloperRole?: boolean;
	/** Whether the exact model accepts developer or system messages after the conversation has started. When false, later system messages are folded into the leading system message. Default: false; the generated model catalog enables it for verified models. */
	supportsMidConvoSystemMessages?: boolean;
	/** Session-affinity header format: `openai` sends `session_id` and `x-client-request-id`; `openai-nosession` sends `x-client-request-id`; `openrouter` sends `x-session-id`. Does not affect the `prompt_cache_key` body param, which is governed by cache retention. Default: auto-detected. */
	sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter";
	/** Whether the provider supports long prompt cache retention. This uses `prompt_cache_options.ttl: "30m"` on GPT-5.6+ and `prompt_cache_retention: "24h"` on earlier models. Default: true. */
	supportsLongCacheRetention?: boolean;
	/** Whether the provider supports strict JSON-schema function tools. Defaults are API-specific; generated OpenAI models enable it explicitly. */
	supportsStrictMode?: boolean;
	/** Whether to emit OpenAI custom tools with Lark/regex grammar formats. When false, grammar-constrained tools fall back to normal function tools. Default: false; the generated model catalog enables it for capable models. */
	supportsOpenAIGrammarTools?: boolean;
	/** Whether the model supports message-anchored `additional_tools` input items. Default: false. */
	supportsAdditionalTools?: boolean;
	/** Whether the model supports client-executed tool search for transcript-anchored additions. Default: false. */
	supportsToolSearch?: boolean;
	/** Whether the model accepts `prompt_cache_options` (OpenAI GPT-5.6+ prompt caching). Older OpenAI models reject the parameter. Default: false. */
	supportsExplicitPromptCacheMode?: boolean;
	/** Whether the provider accepts the `max_output_tokens` parameter. Some Codex-protocol gateways reject it. Default: true. */
	supportsMaxOutputTokens?: boolean;
}

export type ImagesInputContent = TextContent | ImageContent;
export type ImagesOutputContent = TextContent | ImageContent;

export interface ImagesContext {
	input: ImagesInputContent[];
}

export type ImagesStopReason = "stop" | "error" | "aborted";

export interface AssistantImages {
	api: ImageApi;
	provider: Provider;
	model: string;
	output: ImagesOutputContent[];
	responseId?: string;
	usage?: Usage;
	stopReason: ImagesStopReason;
	errorMessage?: string;
	timestamp: number; // Unix timestamp in milliseconds
}

export interface ClassifierChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}

export interface ClassifierScoreQuestion {
	type: "score";
	instructions: string;
	criteria: string[];
}

export interface ClassifierBoolQuestion {
	type: "bool";
	instructions: string;
	criteria: { true: string; false: string };
}

export type ClassifierQuestion = ClassifierChoiceQuestion | ClassifierScoreQuestion | ClassifierBoolQuestion;

export interface ClassifierContext {
	state: JsonObject;
	questions: Record<string, ClassifierQuestion>;
}

export interface ClassifierChoiceAnswer {
	type: "choice";
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface ClassifierScoreAnswer {
	type: "score";
	score: number;
	confidence: number;
}

export interface ClassifierBoolAnswer {
	type: "bool";
	probability: number;
}

export type ClassifierAnswer = ClassifierChoiceAnswer | ClassifierScoreAnswer | ClassifierBoolAnswer;
export type ClassifierStopReason = "stop" | "error" | "aborted";

export interface ClassifierResult {
	api: ClassifierApi;
	provider: Provider;
	model: string;
	answers: Record<string, ClassifierAnswer>;
	/** Token usage and its cost at the model's catalog price, when the service reports token counts. */
	usage?: Usage;
	stopReason: ClassifierStopReason;
	errorMessage?: string;
	timestamp: number; // Unix timestamp in milliseconds
}

export type ImageApi = "openrouter-images" | (string & {});
export type ClassifierApi =
	| "typesafe-system-one"
	| "cloudflare-workers-ai-system-one"
	| "llama-cpp-classify"
	| (string & {});
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
export type ProviderHeaders = Record<string, string | null>;
export interface OperationOptions {
	accountId?: string;
	apiKey?: string;
	signal?: AbortSignal;
	headers?: ProviderHeaders;
	fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	onPayload?: (payload: unknown, model: AnyModel) => unknown | undefined | Promise<unknown | undefined>;
	onResponse?: (
		response: { status: number; headers: Record<string, string> },
		model: AnyModel,
	) => void | Promise<void>;
}
export interface ImagesOptions extends OperationOptions {
	metadata?: Record<string, unknown>;
}
export interface ClassifierOptions extends OperationOptions {
	temperature?: number;
}
export type ImageModel<TApi extends ImageApi = ImageApi> = Pick<
	Model,
	"id" | "name" | "provider" | "baseUrl" | "input" | "cost" | "headers"
> & { type: "image"; api: TApi; output: ("text" | "image")[] };
export type ClassifierModel<TApi extends ClassifierApi = ClassifierApi> = Pick<
	Model,
	"id" | "name" | "provider" | "baseUrl" | "input" | "cost" | "headers" | "contextWindow"
> & { type: "classifier"; api: TApi };
export type AnyModel = Model | ImageModel | ClassifierModel;
export type ImagesFunction<TOptions extends ImagesOptions = ImagesOptions> = (
	model: ImageModel,
	context: ImagesContext,
	options?: TOptions,
) => Promise<AssistantImages>;
export type ClassifierFunction<TOptions extends ClassifierOptions = ClassifierOptions> = (
	model: ClassifierModel,
	context: ClassifierContext,
	options?: TOptions,
) => Promise<ClassifierResult>;
