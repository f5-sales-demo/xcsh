import { expect, test } from "bun:test";
import { SelectedChatVoice } from "../../src/remote-control/selected-chat-voice";
import type { SessionTarget } from "../../src/remote-control/session";

test("disconnect retires only the selected connection's client adapters", async () => {
	const closed: string[] = [];
	let current = "";
	const bridge = new SelectedChatVoice(
		{ sessionId: "chat" } as SessionTarget,
		() => {},
		() => {
			const id = current;
			return {
				call: async () => {},
				subscribe: () => () => {},
				close: async () => {
					closed.push(id);
				},
			};
		},
	);
	try {
		for (const clientId of ["first-client", "second-client"]) {
			current = clientId;
			await bridge.handle({ type: "voice_request", action: "capabilities", clientId, requestId: clientId });
			await bridge.handle({
				type: "voice_request",
				action: "history",
				clientId,
				requestId: clientId,
				chatId: "chat",
			});
		}
		await bridge.disconnectClient("second-client");
		expect(closed).toEqual(["second-client"]);
		await bridge.disconnectClient("second-client");
		expect(closed).toEqual(["second-client"]);
	} finally {
		await bridge.close();
	}
	expect(closed).toEqual(["second-client", "first-client"]);
});

test("voice attaches the selected chat without fresh thread creation or backend configuration", async () => {
	const requests: { method: string; params: Record<string, unknown> }[] = [];
	const target = { sessionId: "selected-chat" } as SessionTarget;
	const bridge = new SelectedChatVoice(
		target,
		() => {},
		() => ({
			call: async (_id, method, params) => {
				requests.push({ method, params });
			},
			subscribe: () => () => {},
			close: async () => {},
		}),
	);
	await bridge.handle({
		type: "voice_request",
		action: "start",
		requestId: "start-fixture",
		chatId: target.sessionId,
		sdp: "v=0\r\nfixture",
	});
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		method: "thread/realtime/start",
		params: { threadId: "selected-chat", model: "gpt-live-1", transport: { type: "webrtc" } },
	});
	expect(requests[0].params).not.toHaveProperty("sandbox");
	expect(requests[0].params).not.toHaveProperty("approvalPolicy");
	await bridge.close();
});

test("a stale selected chat or disposed parent cannot create a call", async () => {
	let calls = 0;
	const bridge = new SelectedChatVoice(
		{ sessionId: "current" } as SessionTarget,
		() => {},
		() => {
			calls++;
			throw new Error("No call allowed");
		},
	);
	await bridge.handle({ type: "voice_request", action: "start", requestId: "stale", chatId: "old", sdp: "v=0" });
	await bridge.close();
	await bridge.handle({ type: "voice_request", action: "start", requestId: "closed", chatId: "current", sdp: "v=0" });
	expect(calls).toBe(0);
});

test("client-scoped signaling and failed-client cleanup cannot stop a different panel", async () => {
	const frames: { clientId?: string; method: string }[] = [];
	const instances: { calls: string[] }[] = [];
	const bridge = new SelectedChatVoice(
		{ sessionId: "chat" } as SessionTarget,
		frame => {
			frames.push(frame);
		},
		() => {
			const instance = { calls: [] as string[] };
			instances.push(instance);
			return {
				call: async (_id, method) => {
					instance.calls.push(method);
					if (instances.indexOf(instance) === 1 && method.endsWith("start"))
						throw new Error("Rejected second client");
				},
				subscribe: () => () => {},
				close: async () => {},
			};
		},
	);
	for (const clientId of ["panel-a", "panel-b"])
		await bridge.handle({ type: "voice_request", clientId, requestId: `caps-${clientId}`, action: "capabilities" });
	await bridge.handle({
		type: "voice_request",
		clientId: "panel-a",
		requestId: "a-start",
		action: "start",
		chatId: "chat",
		sdp: "v=0",
	});
	await bridge.handle({
		type: "voice_request",
		clientId: "panel-b",
		requestId: "b-start",
		action: "start",
		chatId: "chat",
		sdp: "v=0",
	});
	await bridge.handle({
		type: "voice_request",
		clientId: "panel-b",
		requestId: "b-stop",
		action: "stop",
		chatId: "chat",
	});
	expect(instances[0]!.calls).toEqual(["thread/realtime/start"]);
	expect(instances[1]!.calls).toEqual(["thread/realtime/start", "thread/realtime/stop"]);
	expect(frames.find(frame => frame.method === "xcsh/voice/error")?.clientId).toBe("panel-b");
	await bridge.close();
});

test("selected-chat Stop preserves cleanup intent outside the provider schema", async () => {
	const requests: Record<string, unknown>[] = [];
	const bridge = new SelectedChatVoice(
		{ sessionId: "fixture-chat" } as SessionTarget,
		() => {},
		() => ({
			call: async (_id, _method, params) => {
				requests.push(params);
			},
			subscribe: () => () => {},
			close: async () => {},
		}),
	);
	for (const cleanup of [true, false])
		await bridge.handle({
			type: "voice_request",
			action: "stop",
			requestId: `stop-${cleanup}`,
			chatId: "fixture-chat",
			cleanup,
		});
	expect(requests.map(value => value.xcshVoice)).toEqual([{ cleanup: true }, { cleanup: false }]);
	await bridge.close();
});
