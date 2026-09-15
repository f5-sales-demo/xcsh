import { expect, test } from "bun:test";
import { replayVoiceFirstSequence } from "../../src/remote-control/voice-first-replay";

const event = (direction: "in" | "out", message: Record<string, unknown>) => ({
	layer: "rpc",
	direction,
	message,
});

test("stateful voice-first replay waits for each response and never invents realtime start", async () => {
	const sent: string[] = [];
	const notifications = [
		{ method: "thread/started", params: { thread: { id: "actual-thread", source: "appServer" } } },
	];
	const result = await replayVoiceFirstSequence(
		[
			event("in", { id: 1, method: "thread/start", params: {} }),
			event("out", { id: 1, result: { thread: { id: { $ref: "thread" }, source: "appServer" } } }),
			event("out", {
				method: "thread/started",
				params: { thread: { id: { $ref: "thread" }, source: "appServer" } },
			}),
		],
		{
			send: async request => {
				sent.push(String(request.method));
				return { id: 1, result: { thread: { id: "actual-thread", source: "appServer" } } };
			},
			nextNotification: async () => notifications.shift()!,
		},
	);
	expect(sent).toEqual(["thread/start"]);
	expect(result.requests).not.toContain("thread/realtime/start");
	expect(result.success).toBe(false);
	expect(result.missingSuccessSignals).toContain("thread/realtime/start:result");
});

test("voice-first success oracle requires call creation, started, and SDP", async () => {
	const notifications = [
		{ method: "thread/started", params: { thread: { id: "thread" } } },
		{ method: "thread/realtime/started", params: { realtimeSessionId: "call", version: "v3" } },
		{ method: "thread/realtime/sdp", params: { realtimeSessionId: "call", sdp: "fixture" } },
	];
	const events = [
		event("in", { id: 1, method: "thread/start", params: {} }),
		event("out", { id: 1, result: { thread: { id: { $ref: "thread" } } } }),
		event("out", { method: "thread/started", params: { thread: { id: { $ref: "thread" } } } }),
		event("in", { id: 2, method: "thread/realtime/start", params: { threadId: { $ref: "thread" } } }),
		event("out", { id: 2, result: {} }),
		event("out", {
			method: "thread/realtime/started",
			params: { realtimeSessionId: { $ref: "call" }, version: "v3" },
		}),
		event("out", {
			method: "thread/realtime/sdp",
			params: { realtimeSessionId: { $ref: "call" }, sdp: { $redacted: "sdp", valueType: "string" } },
		}),
	];
	const result = await replayVoiceFirstSequence(events, {
		send: async request =>
			request.method === "thread/start" ? { id: 1, result: { thread: { id: "thread" } } } : { id: 2, result: {} },
		nextNotification: async () => notifications.shift()!,
	});
	expect(result.success).toBe(true);
	expect(result.missingSuccessSignals).toEqual([]);
	expect(result.immediateCleanupSignals).toEqual([]);
});

test("replay rejects duplicate responses and identity drift", async () => {
	const duplicate = [
		event("in", { id: 1, method: "thread/start", params: {} }),
		event("out", { id: 1, result: {} }),
		event("out", { id: 1, result: {} }),
	];
	await expect(
		replayVoiceFirstSequence(duplicate, {
			send: async () => ({ id: 1, result: {} }),
			nextNotification: async () => ({}),
		}),
	).rejects.toThrow("duplicate response");

	const drift = [
		event("in", { id: 1, method: "thread/start", params: {} }),
		event("out", { id: 1, result: { thread: { id: { $ref: "thread" } } } }),
		event("out", { method: "thread/started", params: { thread: { id: { $ref: "thread" } } } }),
	];
	await expect(
		replayVoiceFirstSequence(drift, {
			send: async () => ({ id: 1, result: { thread: { id: "first" } } }),
			nextNotification: async () => ({ method: "thread/started", params: { thread: { id: "second" } } }),
		}),
	).rejects.toThrow("identity mismatch");
});
