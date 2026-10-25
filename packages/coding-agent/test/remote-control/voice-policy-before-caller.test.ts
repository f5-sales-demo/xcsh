import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

const request = {
	transport: { type: "existingCall", callId: "owned-synthetic-call" },
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
};
const persona = { tools: [{ name: "read" }], history: "" };

function fixture(acknowledge = true) {
	let handlers!: VoiceHandlers;
	const sent: Record<string, any>[] = [];
	const records: Record<string, any>[] = [];
	const deps: VoiceDependencies = {
		persona: () => persona,
		authenticate: async () => ({ accessToken: "unit-only", accountId: "example-account" }),
		open: async (_url, _headers, next) => {
			handlers = next;
			queueMicrotask(() =>
				next.message(JSON.stringify({ type: "session.started", session: { id: "unit-session" } })),
			);
			return {
				bufferedAmount: 0,
				close: () => {},
				send: text => {
					const message = JSON.parse(text);
					if (message.type === "session.instructions.append") {
						const event = {
							type: "session.instructions.appended",
							client_event_id: message.event_id,
							start_ms: 0,
							end_ms: 1,
						};
						queueMicrotask(() => handlers.message(JSON.stringify(event)));
						return;
					}
					if (
						message.type === "session.update" &&
						JSON.stringify(message.session) ===
							JSON.stringify({ delegation: { type: "client", ack_filler: false } })
					) {
						queueMicrotask(() =>
							handlers.message(JSON.stringify({ type: "session.updated", session: { id: "unit-session" } })),
						);
						return;
					}
					sent.push(message);
					if (
						acknowledge &&
						message.type === "session.context.append" &&
						message.content?.[0]?.text?.startsWith("You are xcsh")
					) {
						queueMicrotask(() =>
							next.message(
								JSON.stringify({
									type: "session.context.appended",
									client_event_id: message.event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
					}
				},
			};
		},
		record: async record => {
			records.push(record);
		},
		records: () => records,
		emit: () => {},
		delegate: async () => "no task expected",
	};
	return {
		voice: new NativeVoice(deps),
		sent,
		records,
		receive: (message: unknown) => handlers.message(JSON.stringify(message)),
	};
}

test("existing calls retain the creator policy before caller input", async () => {
	const f = fixture();
	await f.voice.start(request);
	try {
		expect(f.sent).toEqual([]);
		expect(
			f.records.some(
				record =>
					record.kind === "voicePolicyDiagnostic" &&
					record.outcome === "prepared" &&
					record.creationOwnership === "phone",
			),
		).toBe(true);
		expect(
			f.records.some(record => record.kind === "voicePolicyDiagnostic" && record.outcome === "acknowledged"),
		).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("an unrelated acknowledgment does not change a ready existing call", async () => {
	const f = fixture(false);
	let settled = false;
	const opening = f.voice.start(request).then(
		() => {
			settled = true;
		},
		() => {},
	);
	await Bun.sleep(10);
	f.receive({ type: "session.instructions.appended", client_event_id: "unrelated", start_ms: 0, end_ms: 1 });
	await Bun.sleep(10);
	try {
		expect(settled).toBe(true);
		expect(
			f.records.some(record => record.kind === "voicePolicyDiagnostic" && record.outcome === "acknowledged"),
		).toBe(false);
	} finally {
		await f.voice.stop();
		await opening;
	}
});
