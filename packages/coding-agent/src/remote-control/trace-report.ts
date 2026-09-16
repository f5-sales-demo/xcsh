import { isDeepStrictEqual } from "node:util";
import type { AssembledTraceEvent } from "./trace-assembler";

/** Inventory is evidence for review, never a substitute for scenario acceptance. */
export function inventoryProtocolTrace(rows: readonly Record<string, any>[]) {
	const signals = new Map<string, number>();
	const pending = new Map<string, { method: string; direction: string; elapsedMs: number }>();
	const requests: Record<string, unknown>[] = [];
	let uncorrelatedResponses = 0;
	for (const row of rows) {
		if (row.kind !== "event") continue;
		const message = row.message;
		if (!message || typeof message !== "object") continue;
		const name =
			typeof message.method === "string"
				? message.method
				: typeof message.type === "string"
					? message.type
					: "error" in message
						? "error"
						: "result" in message
							? "result"
							: "unclassified";
		const signal = `${row.layer}/${row.direction}/${name}`;
		signals.set(signal, (signals.get(signal) ?? 0) + 1);
		if (row.layer !== "rpc" || message.id == null) continue;
		const id = JSON.stringify(message.id);
		if (typeof message.method === "string") {
			pending.set(`${row.direction}/${id}`, {
				method: message.method,
				direction: row.direction,
				elapsedMs: row.elapsedMs,
			});
		} else if ("result" in message || "error" in message) {
			const key = `${row.direction === "in" ? "out" : "in"}/${id}`;
			const request = pending.get(key);
			if (!request) {
				uncorrelatedResponses++;
				continue;
			}
			pending.delete(key);
			requests.push({
				method: request.method,
				direction: request.direction,
				latencyMs: row.elapsedMs - request.elapsedMs,
				...("error" in message
					? { outcome: "error", errorCode: message.error?.code }
					: {
							outcome: "result",
							resultKeys:
								message.result && typeof message.result === "object" ? Object.keys(message.result).sort() : [],
						}),
			});
		}
	}
	return {
		signals: Object.fromEntries([...signals].sort(([a], [b]) => a.localeCompare(b))),
		requests,
		unanswered: [...pending.values()].map(({ method, direction }) => ({ method, direction })),
		uncorrelatedResponses,
	};
}

interface RelayMessage {
	client_id?: unknown;
	stream_id?: unknown;
	type?: unknown;
	message?: Record<string, any>;
}

function identity(value: unknown): string | undefined {
	if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
	if (value && typeof value === "object" && typeof (value as Record<string, unknown>).$ref === "string")
		return String((value as Record<string, unknown>).$ref);
	return undefined;
}

function redactedBytes(value: unknown): number | null {
	if (!value || typeof value !== "object") return null;
	const bytes = (value as Record<string, unknown>).bytes;
	return typeof bytes === "number" ? bytes : null;
}

function relay(event: Pick<AssembledTraceEvent, "layer" | "message">): RelayMessage | undefined {
	if (event.layer !== "relay" || !event.message || typeof event.message !== "object") return undefined;
	return event.message as RelayMessage;
}

/**
 * Correlate the requester relay stream around a voice-first thread/start. The
 * report intentionally contains only already-sanitized identities, shapes and
 * timing; it never reconstructs redacted values.
 */
export function voiceFirstInitializationReport(events: readonly AssembledTraceEvent[]) {
	const requestEvent = events.find(event => {
		const frame = relay(event);
		return event.direction === "in" && frame?.type === "client_message" && frame.message?.method === "thread/start";
	});
	if (!requestEvent) throw new Error("Voice-first trace has no requester thread/start relay frame");
	const requestFrame = relay(requestEvent)!;
	const requestId = identity(requestFrame.message?.id);
	const clientId = identity(requestFrame.client_id);
	const streamId = identity(requestFrame.stream_id);
	if (!requestId || !clientId || !streamId) throw new Error("Voice-first thread/start has incomplete relay identity");

	const onRequesterStream = (event: AssembledTraceEvent): Record<string, any> | undefined => {
		const frame = relay(event);
		if (
			event.direction !== "out" ||
			frame?.type !== "server_message" ||
			identity(frame.client_id) !== clientId ||
			identity(frame.stream_id) !== streamId
		)
			return undefined;
		return frame.message;
	};
	const responseEvent = events.find(event => {
		const message = onRequesterStream(event);
		return identity(message?.id) === requestId && ("result" in (message ?? {}) || "error" in (message ?? {}));
	});
	if (!responseEvent) throw new Error("Voice-first thread/start has no response on its requester stream");
	const response = onRequesterStream(responseEvent)!;
	const responseThread = response.result?.thread;
	const threadId = identity(responseThread?.id);
	if (!threadId) throw new Error("Voice-first thread/start response has no thread identity");
	const startedEvent = events.find(event => {
		const message = onRequesterStream(event);
		return message?.method === "thread/started" && identity(message.params?.thread?.id) === threadId;
	});
	if (!startedEvent) throw new Error("Voice-first thread/start has no requester thread/started notification");
	const started = onRequesterStream(startedEvent)!;

	const laterInboundMethods = events.flatMap(event => {
		if (event.sequence <= startedEvent.sequence || event.direction !== "in") return [];
		const frame = relay(event);
		if (
			frame?.type !== "client_message" ||
			identity(frame.client_id) !== clientId ||
			identity(frame.stream_id) !== streamId ||
			typeof frame.message?.method !== "string"
		)
			return [];
		return [{ method: frame.message.method, elapsedMs: event.elapsedMs, sequence: event.sequence }];
	});
	const laterOutboundMethods = events.flatMap(event => {
		if (event.sequence <= startedEvent.sequence) return [];
		const message = onRequesterStream(event);
		return typeof message?.method === "string"
			? [{ method: message.method, elapsedMs: event.elapsedMs, sequence: event.sequence }]
			: [];
	});
	const firstMethod = (method: string) => laterInboundMethods.find(value => value.method === method);
	const nameSet = firstMethod("thread/name/set");
	const nameUpdated = laterOutboundMethods.find(value => value.method === "thread/name/updated");
	const realtimeStart = firstMethod("thread/realtime/start");
	const stop = firstMethod("thread/realtime/stop");
	const archive = firstMethod("thread/archive");
	const cleanupBeforeRealtimeStart = (value: typeof stop) =>
		Boolean(value && (!realtimeStart || value.sequence < realtimeStart.sequence));
	const responseSource = responseThread.source;
	const notificationSource = started.params?.thread?.source;

	return {
		requester: { clientId, streamId, requestId, threadId },
		threadStart: {
			requestSequence: requestEvent.sequence,
			responseSequence: responseEvent.sequence,
			notificationSequence: startedEvent.sequence,
			latencyMs: responseEvent.elapsedMs - requestEvent.elapsedMs,
			responseBeforeNotification: responseEvent.sequence < startedEvent.sequence,
			threadIdentityEqual: identity(responseThread.id) === identity(started.params.thread.id),
			sourceShapeEqual: isDeepStrictEqual(responseSource, notificationSource),
			responseSourceBytes: redactedBytes(responseSource),
			notificationSourceBytes: redactedBytes(notificationSource),
		},
		clientProgression: {
			nameSet: Boolean(nameSet),
			nameUpdated: Boolean(nameUpdated),
			realtimeStart: Boolean(realtimeStart),
			realtimeStartAfterNameUpdatedMs:
				nameUpdated && realtimeStart ? realtimeStart.elapsedMs - nameUpdated.elapsedMs : null,
			stopBeforeRealtimeStart: cleanupBeforeRealtimeStart(stop),
			archiveBeforeRealtimeStart: cleanupBeforeRealtimeStart(archive),
		},
	};
}

export function compareVoiceFirstInitialization(
	referenceEvents: readonly AssembledTraceEvent[],
	candidateEvents: readonly AssembledTraceEvent[],
) {
	const reference = voiceFirstInitializationReport(referenceEvents);
	const candidate = voiceFirstInitializationReport(candidateEvents);
	const divergences: string[] = [];
	if (!candidate.threadStart.responseBeforeNotification) divergences.push("requester-response-order");
	if (!candidate.threadStart.threadIdentityEqual) divergences.push("thread-identity");
	if (!candidate.threadStart.sourceShapeEqual) divergences.push("response-notification-source");
	if (candidate.threadStart.responseSourceBytes !== reference.threadStart.responseSourceBytes)
		divergences.push("reference-response-source");
	if (candidate.threadStart.notificationSourceBytes !== reference.threadStart.notificationSourceBytes)
		divergences.push("reference-notification-source");
	if (!candidate.clientProgression.realtimeStart) divergences.push("missing-thread-realtime-start");
	if (candidate.clientProgression.stopBeforeRealtimeStart || candidate.clientProgression.archiveBeforeRealtimeStart)
		divergences.push("immediate-cleanup");
	return { reference, candidate, divergences, firstDivergence: divergences[0] ?? null };
}
