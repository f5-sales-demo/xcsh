import { expect, test } from "bun:test";
import { reconcileVoiceCall } from "../../src/remote-control/voice-call-recovery";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

const identity = { callId: "rtc_recovery_fixture", realtimeSessionId: "selected-chat", accountId: "selected-account" };
const auth = { accessToken: "fixture-secret", accountId: identity.accountId };

test("known call reconciliation closes its pinned sideband without creating or configuring another model", async () => {
	const sent: unknown[] = [];
	let closes = 0;
	const result = await reconcileVoiceCall(
		identity,
		{
			authenticate: async () => auth,
			open: async (url, headers, handlers) => {
				expect(url).toBe("wss://api.openai.com/v1/live/rtc_recovery_fixture");
				expect(headers["ChatGPT-Account-Id"]).toBe(identity.accountId);
				expect(headers["openai-alpha"]).toBe("quicksilver=v2");
				expect(headers["x-session-id"]).toBe(identity.realtimeSessionId);
				return {
					bufferedAmount: 0,
					close: () => {
						closes++;
					},
					send: data => {
						sent.push(JSON.parse(data));
						handlers.message(JSON.stringify({ type: "session.closed" }));
					},
				};
			},
		},
		50,
	);
	expect(result.confirmed).toBe(true);
	expect(sent).toEqual([{ type: "session.close" }]);
	expect(closes).toBe(1);
});

test("reconciliation refuses another selected subscription before opening the call", async () => {
	let opens = 0;
	const result = await reconcileVoiceCall(
		identity,
		{
			authenticate: async () => ({ ...auth, accountId: "different-account" }),
			open: async () => {
				opens++;
				throw new Error("No connection allowed");
			},
		},
		20,
	);
	expect(result.confirmed).toBe(false);
	expect(opens).toBe(0);
});

test("a lost sideband remains unconfirmed while late connection handles are reaped", async () => {
	let closed = 0;
	let finish: (value: { bufferedAmount: number; close(): void; send(): void }) => void = () => {};
	const pending = reconcileVoiceCall(
		identity,
		{
			authenticate: async () => auth,
			open: () =>
				new Promise(resolve => {
					finish = resolve;
				}),
		},
		15,
	);
	expect((await pending).confirmed).toBe(false);
	finish({
		bufferedAmount: 0,
		close: () => {
			closed++;
		},
		send: () => {
			throw new Error("No late mutation");
		},
	});
	await Promise.resolve();
	expect(closed).toBe(1);
});

test("malformed final usage cannot confirm closure", async () => {
	let events: VoiceHandlers;
	const result = await reconcileVoiceCall(
		identity,
		{
			authenticate: async () => auth,
			open: async (_url, _headers, handlers) => {
				events = handlers;
				return {
					bufferedAmount: 0,
					close: () => {},
					send: () => {
						events.message(JSON.stringify({ type: "session.closed", usage: { seconds: -1 } }));
						events.closed();
					},
				};
			},
		},
		20,
	);
	expect(result.confirmed).toBe(false);
});
