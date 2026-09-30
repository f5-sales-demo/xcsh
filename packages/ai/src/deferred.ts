import { buildParams } from "./providers/openai-responses";
import { processResponsesStream } from "./providers/openai-responses-shared";
import { validateFinalResponsesRequest } from "./providers/sol-request-boundary";
import { getEnvApiKey } from "./stream";
import type { AssistantMessage, Context, DeferredHandle, Model, OperationOptions } from "./types";
import { createOpenAIResponsesHistoryPayload } from "./utils";
import { AssistantMessageEventStream } from "./utils/event-stream";
import { retryProviderRequest } from "./utils/provider-retry";

export type DeferredRequestOptions = OperationOptions &
	Pick<
		import("./providers/openai-responses").OpenAIResponsesOptions,
		"reasoning" | "reasoningSummary" | "promptCache" | "serviceTier" | "toolChoice" | "maxTokens"
	>;

export interface DeferredResponse {
	id: string;
	status: "queued" | "in_progress" | "completed" | "incomplete" | "failed" | "cancelled";
	output: Record<string, unknown>[];
}
function validateRoute(model: Model, handle?: DeferredHandle): void {
	if (model.type !== undefined && model.type !== "chat") throw new Error("Deferred operations require a chat model");
	if (model.api !== "openai-responses" || model.provider === "openai-codex")
		throw new Error("Deferred Responses unsupported on this route");
	if (
		handle &&
		(handle.provider !== model.provider ||
			handle.modelId !== model.id ||
			handle.api !== model.api ||
			handle.baseUrl !== model.baseUrl)
	)
		throw new Error("Deferred handle belongs to a different route");
	if (handle?.expiresAt && handle.expiresAt < Date.now()) throw new Error("Deferred handle expired");
}
async function request(
	model: Model,
	path: string,
	method: string,
	options: OperationOptions,
	payload?: unknown,
): Promise<DeferredResponse> {
	options.signal?.throwIfAborted();
	const apiKey = options.apiKey ?? getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const timeoutSignal = options.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined;
	const signal =
		options.signal && timeoutSignal
			? AbortSignal.any([options.signal, timeoutSignal])
			: (options.signal ?? timeoutSignal);
	const response = await retryProviderRequest(
		async () => {
			const result = await (options.fetch ?? globalThis.fetch)(
				`${model.baseUrl.replace(/\/+$/, "")}/responses${path}`,
				{
					method,
					headers: {
						...model.headers,
						...options.headers,
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
					signal,
				},
			);
			if (!result.ok)
				throw Object.assign(new Error(`Deferred Responses HTTP ${result.status}`), {
					status: result.status,
					headers: result.headers,
				});
			return result;
		},
		{ ...options, signal },
	);
	await options.onResponse?.(
		{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
		model,
	);
	const body = (await response.json()) as DeferredResponse;
	if (
		!body ||
		typeof body.id !== "string" ||
		!Array.isArray(body.output) ||
		!["queued", "in_progress", "completed", "incomplete", "failed", "cancelled"].includes(body.status)
	)
		throw new Error("Malformed deferred response");
	return body;
}
export async function requestDeferred(
	model: Model,
	context: Context,
	options: DeferredRequestOptions = {},
): Promise<DeferredHandle> {
	options.signal?.throwIfAborted();
	validateRoute(model);
	let payload: Record<string, unknown> = {
		...buildParams(
			model as Model<"openai-responses">,
			context,
			options as import("./providers/openai-responses").OpenAIResponsesOptions,
			undefined,
		).params,
		background: true,
		store: true,
		stream: false,
	};
	const replacement = await options.onPayload?.(payload, model);
	if (replacement !== undefined) payload = replacement as Record<string, unknown>;
	validateFinalResponsesRequest(model, payload);
	Object.assign(payload, { background: true, store: true, stream: false });
	const response = await request(model, "", "POST", options, payload);
	return {
		provider: model.provider,
		modelId: model.id,
		api: model.api,
		baseUrl: model.baseUrl,
		id: response.id,
		pollAfterMs: 1000,
		data: {
			grammarTools: (context.tools ?? [])
				.filter(tool => tool.constrainedSampling && tool.constrainedSampling.type === "grammar")
				.map(tool => [tool.name, (tool.parameters as { required?: string[] }).required?.[0] ?? "input"]),
		},
	};
}
export async function fetchDeferred(
	model: Model,
	handle: DeferredHandle,
	options: OperationOptions = {},
): Promise<AssistantMessage> {
	validateRoute(model, handle);
	const response = await request(model, `/${encodeURIComponent(handle.id)}`, "GET", options);
	if (response.id !== handle.id) throw new Error("Deferred response identity does not match its handle");
	const output: AssistantMessage = {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		responseId: response.id,
		content: [],
		stopReason: "stop",
		timestamp: Date.now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	if (response.status === "queued" || response.status === "in_progress") {
		output.deferred = handle;
		return output;
	}
	if (response.status === "cancelled" || response.status === "failed") {
		output.stopReason = "error";
		output.errorMessage = `Deferred response ${response.status}`;
		return output;
	}
	async function* events() {
		for (const [output_index, item] of response.output.entries()) {
			if (!item || typeof item !== "object" || typeof item.type !== "string")
				throw new Error("Malformed deferred output item");
			yield { type: "response.output_item.added", output_index, item };
			yield { type: "response.output_item.done", output_index, item };
		}
		yield { type: response.status === "incomplete" ? "response.incomplete" : "response.completed", response };
	}
	const stream = new AssistantMessageEventStream();
	try {
		await processResponsesStream(
			events() as AsyncIterable<import("openai").default.Responses.ResponseStreamEvent>,
			output,
			stream,
			model,
			{
				signal: options.signal,
				grammarToolInputProperties: new Map(
					(handle.data as { grammarTools?: [string, string][] } | undefined)?.grammarTools ?? [],
				),
			},
		);
	} finally {
		stream.end(output);
	}
	output.providerPayload = createOpenAIResponsesHistoryPayload(model.provider, response.output);
	return output;
}
export async function cancelDeferred(
	model: Model,
	handle: DeferredHandle,
	options: OperationOptions = {},
): Promise<void> {
	validateRoute(model, handle);
	const response = await request(model, `/${encodeURIComponent(handle.id)}/cancel`, "POST", options);
	if (response.id !== handle.id) throw new Error("Deferred cancellation identity does not match its handle");
}
