import { $env } from "@f5-sales-demo/pi-utils";
import { AzureOpenAI } from "openai";
import { getEnvApiKey } from "../stream";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ServiceTier,
	StreamFunction,
	StreamOptions,
	ToolChoice,
} from "../types";
import { createAbortSourceTracker } from "../utils/abort";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump } from "../utils/http-inspector";
import {
	createFirstEventWatchdog,
	getOpenAIStreamIdleTimeoutMs,
	getStreamFirstEventTimeoutMs,
	iterateWithIdleTimeout,
	markFirstStreamEvent,
} from "../utils/idle-iterator";
import { retryProviderRequest } from "../utils/provider-retry";
import { buildParams as buildSharedParams } from "./openai-responses";
import { processResponsesStream } from "./openai-responses-shared";
import { validateFinalResponsesRequest } from "./sol-request-boundary";

const DEFAULT_AZURE_API_VERSION = "v1";
const AZURE_OPENAI_RESPONSES_FIRST_EVENT_TIMEOUT_MESSAGE =
	"Azure OpenAI responses stream timed out while waiting for the first event";

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	for (const entry of value.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const [modelId, deploymentName] = trimmed.split("=", 2);
		if (!modelId || !deploymentName) continue;
		map.set(modelId.trim(), deploymentName.trim());
	}
	return map;
}

function resolveDeploymentName(model: Model<"azure-openai-responses">, options?: AzureOpenAIResponsesOptions): string {
	if (options?.azureDeploymentName) {
		return options.azureDeploymentName;
	}
	const mappedDeployment = parseDeploymentNameMap($env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP).get(model.id);
	return mappedDeployment ?? model.id;
}

// Azure OpenAI Responses-specific options
export interface AzureOpenAIResponsesOptions extends StreamOptions {
	reasoning?: import("../model-thinking").ReasoningEffort;
	reasoningSummary?: "none" | "auto" | "detailed" | "concise" | null;
	azureApiVersion?: string;
	azureResourceName?: string;
	azureBaseUrl?: string;
	azureDeploymentName?: string;
	toolChoice?: ToolChoice;
	serviceTier?: ServiceTier;
}

/**
 * Generate function for Azure OpenAI Responses API
 */
export const streamAzureOpenAIResponses: StreamFunction<"azure-openai-responses"> = (
	model: Model<"azure-openai-responses">,
	context: Context,
	options?: AzureOpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	// Start async processing
	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;
		const deploymentName = resolveDeploymentName(model, options);

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "azure-openai-responses" as Api,
			provider: model.provider,
			model: model.id,
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
		const firstEventTimeoutAbortError = new Error(AZURE_OPENAI_RESPONSES_FIRST_EVENT_TIMEOUT_MESSAGE);
		const { requestAbortController, requestSignal } = abortTracker;

		try {
			// Create Azure OpenAI client
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createClient(model, apiKey, options);
			const { baseUrl } = resolveAzureConfig(model, options);
			let params = buildParams(model, context, options, deploymentName, baseUrl);
			const idleTimeoutMs = getOpenAIStreamIdleTimeoutMs();
			const replacement = await options?.onPayload?.(params, model);
			if (replacement !== undefined) params = replacement as typeof params;
			validateFinalResponsesRequest(model, params as unknown as Record<string, unknown>);
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url: `${baseUrl}/responses`,
				body: params,
			};
			const response = await retryProviderRequest(
				() =>
					client.responses
						.create(params, {
							signal: requestSignal,
							maxRetries: 0,
							...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
						})
						.withResponse(),
				{ maxRetries: options?.maxRetries ?? 5, maxRetryDelayMs: options?.maxRetryDelayMs, signal: requestSignal },
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
			stream.push({ type: "start", partial: output });

			await processResponsesStream(
				iterateWithIdleTimeout(markFirstStreamEvent(openaiStream, firstEventWatchdog), {
					idleTimeoutMs,
					errorMessage: "Azure OpenAI responses stream stalled while waiting for the next event",
					onIdle: () => requestAbortController.abort(),
				}),
				output,
				stream,
				model,
				{
					signal: requestSignal,
					onProviderStreamEvent: options?.onProviderStreamEvent,
					grammarToolInputProperties: new Map(
						(context.tools ?? [])
							.filter(tool => tool.constrainedSampling && tool.constrainedSampling.type === "grammar")
							.map(tool => [tool.name, (tool.parameters as { required?: string[] }).required?.[0] ?? "input"]),
					),
					onFirstToken: () => {
						if (!firstTokenTime) firstTokenTime = Date.now();
					},
				},
			);

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

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
			const firstEventTimeoutError = abortTracker.getLocalAbortReason();
			output.stopReason = abortTracker.wasCallerAbort() ? "aborted" : "error";
			output.errorMessage = firstEventTimeoutError?.message ?? (await finalizeErrorMessage(error, rawRequestDump));
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function normalizeAzureBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function buildDefaultBaseUrl(resourceName: string): string {
	return `https://${resourceName}.openai.azure.com/openai/v1`;
}

function resolveAzureConfig(
	model: Model<"azure-openai-responses">,
	options?: AzureOpenAIResponsesOptions,
): { baseUrl: string; apiVersion: string } {
	const apiVersion = options?.azureApiVersion || $env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;

	const baseUrl = options?.azureBaseUrl?.trim() || $env.AZURE_OPENAI_BASE_URL?.trim() || undefined;
	const resourceName = options?.azureResourceName || $env.AZURE_OPENAI_RESOURCE_NAME;

	let resolvedBaseUrl = baseUrl;

	if (!resolvedBaseUrl && resourceName) {
		resolvedBaseUrl = buildDefaultBaseUrl(resourceName);
	}

	if (!resolvedBaseUrl && model.baseUrl) {
		resolvedBaseUrl = model.baseUrl;
	}

	if (!resolvedBaseUrl) {
		throw new Error(
			"Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.",
		);
	}

	return {
		baseUrl: normalizeAzureBaseUrl(resolvedBaseUrl),
		apiVersion,
	};
}

function createClient(model: Model<"azure-openai-responses">, apiKey: string, options?: AzureOpenAIResponsesOptions) {
	if (!apiKey) {
		const envKey = $env.AZURE_OPENAI_API_KEY;
		if (!envKey) {
			throw new Error(
				"Azure OpenAI API key is required. Set AZURE_OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = envKey;
	}

	const headers = { ...(model.headers ?? {}) };

	if (options?.headers) {
		Object.assign(headers, options.headers);
	}

	const { baseUrl, apiVersion } = resolveAzureConfig(model, options);

	return new AzureOpenAI({
		apiKey,
		apiVersion,
		dangerouslyAllowBrowser: true,
		maxRetries: 5,
		defaultHeaders: headers,
		baseURL: baseUrl,
		fetch: options?.fetch as typeof globalThis.fetch | undefined,
	});
}

function buildParams(
	model: Model<"azure-openai-responses">,
	context: Context,
	options: AzureOpenAIResponsesOptions | undefined,
	deploymentName: string,
	resolvedBaseUrl?: string,
) {
	const { params } = buildSharedParams(
		model as unknown as Model<"openai-responses">,
		context,
		{
			...options,
			strictResponsesPairing: true,
			reasoningSummary: options?.reasoningSummary ?? undefined,
		} as import("./openai-responses").OpenAIResponsesOptions,
		undefined,
		resolvedBaseUrl,
	);
	params.model = deploymentName;
	return params;
}
