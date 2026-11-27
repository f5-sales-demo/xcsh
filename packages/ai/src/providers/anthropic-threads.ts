import { createHash } from "node:crypto";
import { APIError } from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { AnthropicRequestControls, Model, ProviderSessionState, StreamOptions } from "../types";

type ThreadBody = MessageCreateParamsStreaming & {
	thread?: { type: "create" } | { type: "continue"; previous_message_id: string };
};
type Anchor = { id: string; fingerprint: string; messages: MessageParam[]; time: number };

const requestTelemetry = Symbol("anthropic-request-telemetry");
/** Mark only library-generated telemetry; the marker never appears on the wire. */
export function markAnthropicRequestTelemetry<T extends object>(value: T): T {
	Object.defineProperty(value, requestTelemetry, { value: true });
	return value;
}

/** Only typed thread rejections permit a full replay; unrelated 400s remain errors. */
export function isAnthropicThreadReplayError(error: unknown): boolean {
	if (!(error instanceof APIError)) return false;
	const body = error.error as { error?: { details?: { error_code?: string } } } | undefined;
	return ["thread_not_found", "thread_already_continued", "thread_continue_in_flight"].includes(
		body?.error?.details?.error_code ?? "",
	);
}

/** Cache markers are request-local and do not change the server's conversation. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object" && (value as { [requestTelemetry]?: boolean })[requestTelemetry])
		return { requestTelemetry: true };
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => key !== "cache_control")
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, canonical(entry)]),
		);
	return value;
}

function digest(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

export class AnthropicThreadState implements ProviderSessionState {
	#anchor?: Anchor;
	close(): void {
		this.#anchor = undefined;
	}

	prepare(params: MessageCreateParamsStreaming): ThreadBody {
		const { messages, max_tokens: _maxTokens, stream: _stream, ...settings } = params;
		const fingerprint = digest(settings);
		const anchor = this.#anchor;
		// A message id can be continued only once. Consume it before admission so an
		// aborted or concurrent request cannot replay the same continuation.
		this.#anchor = undefined;
		if (
			anchor &&
			Date.now() - anchor.time < 270000 &&
			anchor.fingerprint === fingerprint &&
			messages.length > anchor.messages.length &&
			digest(messages.slice(0, anchor.messages.length)) === digest(anchor.messages)
		) {
			const body: ThreadBody = {
				...params,
				messages: messages.slice(anchor.messages.length),
				thread: { type: "continue", previous_message_id: anchor.id },
			};
			delete body.system;
			delete body.tools;
			return body;
		}
		return { ...params, thread: { type: "create" } };
	}

	commit(params: MessageCreateParamsStreaming, id: string, reply: MessageParam): void {
		const { messages, max_tokens: _maxTokens, stream: _stream, ...settings } = params;
		this.#anchor = {
			id,
			fingerprint: digest(settings),
			messages: structuredClone([...messages, reply]),
			time: Date.now(),
		};
	}
}

// Bound library callers that supply a session id without an explicit resource store.
const standalone = new Map<string, AnthropicThreadState>();

export function getAnthropicThreadState(
	model: Model<"anthropic-messages">,
	baseUrl: string,
	options: StreamOptions & AnthropicRequestControls,
): AnthropicThreadState | undefined {
	const enabled =
		options.messageThreads ??
		model.compat?.supportsMessageThreads ??
		new URL(baseUrl).hostname === "api.anthropic.com";
	if (!enabled || !options.sessionId || options.anthropicCompaction || options.contextManagement?.edits.length)
		return undefined;
	const key = `anthropic-thread:${baseUrl}:${model.id}:${options.sessionId}`;
	const store = options.providerSessionState ?? standalone;
	const existing = store.get(key);
	if (existing instanceof AnthropicThreadState) return existing;
	const state = new AnthropicThreadState();
	store.set(key, state);
	if (store === standalone && standalone.size > 16) {
		const oldest = standalone.keys().next().value;
		if (oldest) {
			standalone.get(oldest)?.close();
			standalone.delete(oldest);
		}
	}
	return state;
}
