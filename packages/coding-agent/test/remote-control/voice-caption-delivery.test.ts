import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

async function fixture() {
	let handlers!: VoiceHandlers;
	const events: { method: string; params: Record<string, any> }[] = [];
	const records: Record<string, any>[] = [];
	const titles: string[] = [];
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-voice-account" }),
		open: async (_url, _headers, next) => {
			handlers = next;
			queueMicrotask(() => next.message(JSON.stringify({ type: "session.started", session: { id: "example" } })));
			return {
				send: text => {
					if (JSON.parse(text).type === "session.instructions.append")
						queueMicrotask(() =>
							next.message(
								JSON.stringify({
									type: "session.context.appended",
									client_event_id: JSON.parse(text).event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
					if (JSON.parse(text).type === "session.context.append")
						queueMicrotask(() =>
							next.message(JSON.stringify({ type: "session.context.appended", start_ms: 0, end_ms: 1 })),
						);
				},
				close() {},
				bufferedAmount: 0,
			};
		},
		emit: (method, params) => events.push({ method, params }),
		records: () => records,
		record: async record => {
			records.push(record);
		},
		title: text => {
			titles.push(text);
		},
		delegate: async () => {
			throw new Error("Identity must not delegate");
		},
	};
	const voice = new NativeVoice(deps);
	await voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "existingCall", callId: "example-call" },
	});
	return { voice, events, records, titles, receive: (event: unknown) => handlers.message(JSON.stringify(event)) };
}

test("phonetic assistant caption fragments and saved timeline use xcsh; audio and caller text stay intact", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Say ek-see-shell" } });
		f.receive({ type: "turn.done", turn: { role: "user", id: "caller", transcript: "Say ek-see-shell" } });
		for (const text of ["I’m ek", "-see-", "shell", "."])
			f.receive({ type: "output_transcript.added", item: { text } });
		f.receive({ type: "turn.done", turn: { role: "assistant", id: "identity", transcript: "I’m ek-see-shell." } });
		f.receive({ type: "output_audio.delta", audio: "synthetic-audio" });
		await Bun.sleep(25);
		expect(
			f.events
				.filter(e => e.method === "thread/realtime/transcript/delta" && e.params.role === "assistant")
				.map(e => e.params.delta)
				.join(""),
		).toBe("I’m xcsh.");
		expect(
			f.events.find(e => e.method === "thread/realtime/transcript/done" && e.params.role === "assistant")?.params
				.text,
		).toBe("I’m xcsh.");
		expect(f.records.find(r => r.kind === "transcript" && r.role === "assistant")).toMatchObject({
			text: "I’m xcsh.",
			sourceText: "I’m ek-see-shell.",
			captionFormat: "xcsh-branding-v1",
		});
		expect(f.records.find(r => r.kind === "voiceTimeline" && r.item.role === "assistant")?.item.text).toBe(
			"I’m xcsh.",
		);
		expect(f.records.find(r => r.kind === "transcript" && r.role === "user")?.text).toBe("Say ek-see-shell");
		expect(f.titles).toEqual(["I’m xcsh."]);
		expect(f.events.find(e => e.method === "thread/realtime/outputAudio/delta")?.params.audio.data).toBe(
			"synthetic-audio",
		);
	} finally {
		await f.voice.stop();
	}
});

test("assistant final without deltas is formatted and repeated final remains deduplicated", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
		const final = { type: "turn.done", turn: { role: "assistant", id: "identity", transcript: "I’m ek-see-shell." } };
		f.receive(final);
		f.receive(final);
		await Bun.sleep(20);
		expect(f.records.filter(r => r.kind === "transcript")).toHaveLength(1);
		expect(f.records.find(r => r.kind === "transcript")?.text).toBe("I’m xcsh.");
	} finally {
		await f.voice.stop();
	}
});

test("closing a partial spoken name seals the canonical caption before closure", async () => {
	const f = await fixture();
	f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
	f.receive({ type: "output_transcript.added", item: { text: "I’m ek-see-shell" } });
	await Bun.sleep(10);
	await f.voice.stop();
	expect(f.records.find(r => r.kind === "voiceTimeline" && r.item.role === "assistant")?.item.text).toBe("I’m xcsh");
	const transcript = f.events.findIndex(
		e => e.method === "thread/realtime/transcript/delta" && e.params.delta === "xcsh",
	);
	const closed = f.events.findIndex(e => e.method === "thread/realtime/closed");
	expect(transcript).toBeGreaterThan(-1);
	expect(closed).toBeGreaterThan(transcript);
});

test("a repeated final does not erase the following assistant caption prefix", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
		const final = { type: "turn.done", turn: { role: "assistant", id: "old", transcript: "First answer." } };
		f.receive(final);
		await Bun.sleep(10);
		f.receive({ type: "output_transcript.added", item: { text: "I’m ek-see-" } });
		f.receive(final);
		f.receive({ type: "output_transcript.added", item: { text: "shell." } });
		f.receive({ type: "turn.done", turn: { role: "assistant", id: "new", transcript: "I’m ek-see-shell." } });
		await Bun.sleep(20);
		expect(
			f.records.filter(r => r.kind === "voiceTimeline" && r.item.role === "assistant").map(r => r.item.text),
		).toEqual(["First answer.", "I’m xcsh."]);
	} finally {
		await f.voice.stop();
	}
});
