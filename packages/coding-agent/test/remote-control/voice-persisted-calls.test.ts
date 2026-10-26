import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { NativeVoice } from "../../src/remote-control/voice";
import { pendingVoiceCalls } from "../../src/remote-control/voice-persisted-calls";

const hash = "sha256:" + createHash("sha256").update("selected-fixture").digest("hex");
const identity = {
	kind: "voiceCallIdentity",
	providerCallId: "rtc_old_fixture",
	realtimeSessionId: "chat_fixture",
	accountIdSha256: hash,
	creationAttemptId: "attempt_fixture",
};
test("durable closure retires only its matching identity and unresolved attempts remain reserved", () => {
	expect(
		pendingVoiceCalls([
			{ kind: "voiceCallCreation", creationAttemptId: "attempt_fixture", state: "prepared" },
			identity,
		]),
	).toEqual({ calls: [expect.objectContaining({ providerCallId: "rtc_old_fixture" })], uncertainCreation: false });
	expect(
		pendingVoiceCalls([
			identity,
			{ kind: "voiceProviderClosure", providerCallId: "rtc_other_fixture", confirmed: true },
		]).calls,
	).toHaveLength(1);
	expect(
		pendingVoiceCalls([
			identity,
			{ kind: "voiceProviderClosure", providerCallId: "rtc_old_fixture", confirmed: false },
		]).calls,
	).toHaveLength(1);
	expect(
		pendingVoiceCalls([
			identity,
			{ kind: "voiceProviderClosure", providerCallId: "rtc_old_fixture", confirmed: true },
		]).calls,
	).toHaveLength(0);
	expect(
		pendingVoiceCalls([{ kind: "voiceCallCreation", creationAttemptId: "lost_fixture", state: "prepared" }])
			.uncertainCreation,
	).toBe(true);
	expect(
		pendingVoiceCalls([
			{ kind: "voiceCallCreation", creationAttemptId: "lost_fixture", state: "prepared" },
			{ kind: "voiceCallCreation", creationAttemptId: "lost_fixture", state: "rejected" },
		]).uncertainCreation,
	).toBe(false);
	expect(pendingVoiceCalls([{ ...identity, accountIdSha256: "malformed" }]).uncertainCreation).toBe(true);
	expect(pendingVoiceCalls([{ kind: "voiceCallCreation", state: "prepared" }]).uncertainCreation).toBe(true);
	expect(
		pendingVoiceCalls([identity, { ...identity, realtimeSessionId: "different_fixture" }]).uncertainCreation,
	).toBe(true);
});

for (const fixture of [
	{
		name: "known call closes before replacement",
		records: [identity],
		account: "selected-fixture",
		expectedCreates: 1,
		expectedOldOpens: 1,
	},
	{
		name: "wrong subscription cannot attach or replace",
		records: [identity],
		account: "other-fixture",
		expectedCreates: 0,
		expectedOldOpens: 0,
	},
	{
		name: "unknown creation cannot be retried",
		records: [{ kind: "voiceCallCreation", creationAttemptId: "unknown_fixture", state: "prepared" }],
		account: "selected-fixture",
		expectedCreates: 0,
		expectedOldOpens: 0,
	},
])
	test(`cold ownership: ${fixture.name}`, async () => {
		const records: Record<string, unknown>[] = [...fixture.records];
		let creates = 0,
			oldOpens = 0;
		const voice = new NativeVoice({
			authenticate: async () => ({ accessToken: "fixture-secret", accountId: fixture.account }),
			closureTimeoutMs: 30,
			records: () => records,
			record: async record => {
				records.push(record);
			},
			emit: () => {},
			delegate: async () => {
				throw new Error("Recovery must never delegate work");
			},
			createCall: async () => {
				creates++;
				expect(pendingVoiceCalls(records).calls).toHaveLength(0);
				expect(records.at(-1)).toMatchObject({ kind: "voiceCallCreation", state: "prepared" });
				return { callId: "rtc_new_fixture", sdp: "v=0\r\nfixture-answer" };
			},
			open: async (url, headers, handlers) => {
				if (url.includes("rtc_old_fixture")) {
					oldOpens++;
					expect(headers["ChatGPT-Account-Id"]).toBe("selected-fixture");
					expect(headers["x-session-id"]).toBe("chat_fixture");
				} else
					queueMicrotask(() =>
						handlers.message(JSON.stringify({ type: "session.started", session: { id: "rtc_new_fixture" } })),
					);
				return {
					bufferedAmount: 0,
					close: () => {},
					send: value => {
						if (JSON.parse(value).type === "session.close")
							handlers.message(JSON.stringify({ type: "session.closed" }));
					},
				};
			},
		});
		try {
			let error: unknown;
			try {
				await voice.start({
					version: "v3",
					transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
					outputModality: "audio",
					model: "gpt-live-1",
				});
			} catch (value) {
				error = value;
			}
			expect(creates).toBe(0);
			expect(error).toBeDefined();
			await voice.stop("cleanup");
			expect(oldOpens).toBe(0);
			expect(voice.canReleaseAudioOwnership).toBe(false);
			await voice.stop();
			if (fixture.expectedCreates) {
				error = undefined;
				try {
					await voice.start({
						version: "v3",
						transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
						outputModality: "audio",
						model: "gpt-live-1",
					});
				} catch (value) {
					error = value;
				}
			}
			expect(creates).toBe(fixture.expectedCreates);
			expect(oldOpens).toBe(fixture.expectedOldOpens);
			if (fixture.expectedCreates) expect(error).toBeUndefined();
			else {
				expect(error).toBeDefined();
				expect(voice.canReleaseAudioOwnership).toBe(false);
			}
		} finally {
			await voice.stop();
		}
	});

test("a fork does not acquire or close its parent chat provider call", () => {
	const parent = { ...identity, xcshVoice: { chatId: "parent-fixture" } };
	expect(pendingVoiceCalls([parent], "child-fixture").calls).toHaveLength(0);
	expect(pendingVoiceCalls([parent], "parent-fixture").calls).toHaveLength(1);
});
