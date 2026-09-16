import { expect, test } from "bun:test";
import { compareVoiceFirstInitialization, inventoryProtocolTrace } from "../../src/remote-control/trace-report";

test("signal inventory links bidirectional replies, errors, and unanswered requests", () => {
	const row = (direction: string, message: unknown, elapsedMs: number) => ({
		kind: "event",
		layer: "rpc",
		direction,
		message,
		elapsedMs,
	});
	const rows = [
		row("in", { id: { $ref: "one" }, method: "thread/read", params: {} }, 10),
		row("out", { id: { $ref: "one" }, error: { code: -32601 } }, 25),
		row("out", { id: { $ref: "two" }, method: "item/tool/requestUserInput", params: {} }, 30),
		row("in", { id: { $ref: "two" }, result: { answers: {} } }, 70),
		row("in", { id: { $ref: "three" }, method: "turn/start", params: {} }, 80),
	];
	const report = inventoryProtocolTrace(rows);
	expect(report.requests).toContainEqual({
		method: "thread/read",
		direction: "in",
		latencyMs: 15,
		outcome: "error",
		errorCode: -32601,
	});
	expect(report.requests).toContainEqual({
		method: "item/tool/requestUserInput",
		direction: "out",
		latencyMs: 40,
		outcome: "result",
		resultKeys: ["answers"],
	});
	expect(report.unanswered).toEqual([{ method: "turn/start", direction: "in" }]);
});

function relayEvent(
	sequence: number,
	direction: "in" | "out",
	elapsedMs: number,
	client: string,
	stream: string,
	message: Record<string, unknown>,
) {
	return {
		sequence,
		producer: "host",
		sourceSequence: sequence,
		absoluteUnixMs: 1_000 + elapsedMs,
		elapsedMs,
		layer: "relay",
		direction,
		message: {
			type: direction === "in" ? "client_message" : "server_message",
			client_id: { $ref: client },
			stream_id: { $ref: stream },
			message,
		},
	};
}

function voiceFirstEvents(sourceBytes: number, notificationBytes = sourceBytes, withRealtime = true) {
	const source = (bytes: number) => ({ $redacted: "string", valueType: "string", bytes });
	const thread = (bytes: number) => ({ id: { $ref: "thread" }, source: source(bytes) });
	return [
		relayEvent(1, "in", 10, "phone", "requester", {
			id: { $ref: "start" },
			method: "thread/start",
			params: {},
		}),
		relayEvent(2, "out", 30, "observer", "observer-stream", {
			method: "thread/started",
			params: { thread: thread(notificationBytes) },
		}),
		relayEvent(3, "out", 40, "phone", "requester", {
			id: { $ref: "start" },
			result: { thread: thread(sourceBytes) },
		}),
		relayEvent(4, "out", 41, "phone", "requester", {
			method: "thread/started",
			params: { thread: thread(notificationBytes) },
		}),
		relayEvent(5, "in", 50, "phone", "requester", {
			id: { $ref: "name" },
			method: "thread/name/set",
			params: { threadId: { $ref: "thread" } },
		}),
		relayEvent(6, "out", 50, "phone", "requester", {
			method: "thread/name/updated",
			params: { threadId: { $ref: "thread" } },
		}),
		...(withRealtime
			? [
					relayEvent(7, "in", 82, "phone", "requester", {
						id: { $ref: "realtime" },
						method: "thread/realtime/start",
						params: { threadId: { $ref: "thread" } },
					}),
				]
			: [
					relayEvent(7, "in", 82, "phone", "requester", {
						id: { $ref: "stop" },
						method: "thread/realtime/stop",
						params: { threadId: { $ref: "thread" } },
					}),
					relayEvent(8, "in", 90, "phone", "requester", {
						id: { $ref: "archive" },
						method: "thread/archive",
						params: { threadId: { $ref: "thread" } },
					}),
				]),
	];
}

test("voice-first report correlates only the requester stream and identifies the first proven divergence", () => {
	const report = compareVoiceFirstInitialization(voiceFirstEvents(6), voiceFirstEvents(3, 9, false));
	expect(report.reference.threadStart).toMatchObject({
		responseBeforeNotification: true,
		threadIdentityEqual: true,
		sourceShapeEqual: true,
		responseSourceBytes: 6,
		notificationSourceBytes: 6,
	});
	expect(report.reference.clientProgression).toMatchObject({
		nameSet: true,
		nameUpdated: true,
		realtimeStart: true,
		realtimeStartAfterNameUpdatedMs: 32,
		stopBeforeRealtimeStart: false,
		archiveBeforeRealtimeStart: false,
	});
	expect(report.candidate.requester).toEqual({
		clientId: "phone",
		streamId: "requester",
		requestId: "start",
		threadId: "thread",
	});
	expect(report.divergences).toEqual([
		"response-notification-source",
		"reference-response-source",
		"reference-notification-source",
		"missing-thread-realtime-start",
		"immediate-cleanup",
	]);
	expect(report.firstDivergence).toBe("response-notification-source");
});
