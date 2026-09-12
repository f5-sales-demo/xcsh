import { expect, test } from "bun:test";
import { NativeVoice } from "../../src/remote-control/voice";
import { decodeVoiceEvent } from "../../src/remote-control/voice-protocol";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";
import reference from "./fixtures/codex-0.153.4-audio.json";

test.each(reference.cases)("matches the original Rust $version audio parser for $input", row => {
	if (row.version !== "v1" && row.version !== "v3") throw new Error("Unexpected fixture version");
	const event = decodeVoiceEvent(row.version, row.input);
	const actual =
		event?.kind === "audio"
			? {
					data: event.data,
					sampleRate: event.sampleRate,
					numChannels: event.numChannels,
					samplesPerChannel: event.samplesPerChannel ?? null,
					itemId: null,
				}
			: null;
	expect(actual).toEqual(row.expected);
});

// Codex 0.153.4 protocol_v1.rs: u32 sample counts/rates and u16 channels.
const frame = { type: "conversation.output_audio.delta", delta: "AAABAA==", sample_rate: 24000, channels: 1 };
test.each([0, 120, 4294967295])("v1 retains the unsigned sample count %s", samples => {
	expect(decodeVoiceEvent("v1", { ...frame, samples_per_channel: samples, item_id: "ignored-by-v1" })).toEqual({
		kind: "audio",
		data: frame.delta,
		sampleRate: 24000,
		numChannels: 1,
		samplesPerChannel: samples,
	});
});
test.each([-1, 1.5, 4294967296, "120", null])("v1 omits an invalid optional sample count %s", samples => {
	expect(decodeVoiceEvent("v1", { ...frame, samples_per_channel: samples })).toEqual({
		kind: "audio",
		data: frame.delta,
		sampleRate: 24000,
		numChannels: 1,
	});
});
test.each([
	{ sample_rate: -1 },
	{ sample_rate: 4294967296 },
	{ sample_rate: 0.5 },
	{ channels: -1 },
	{ channels: 65536 },
	{ channels: 0.5 },
	{ channels: null, num_channels: 2 },
])("v1 rejects invalid required audio metadata %j", override => {
	expect(decodeVoiceEvent("v1", { ...frame, ...override })).toBeNull();
});
test("v1 uses string data when delta is present with the wrong type", () => {
	expect(decodeVoiceEvent("v1", { ...frame, delta: 12, data: "AAABAA==" })).toEqual({
		kind: "audio",
		data: "AAABAA==",
		sampleRate: 24000,
		numChannels: 1,
	});
});
test("v1 accepts zero and maximum unsigned required values without invented validation", () => {
	for (const [sampleRate, numChannels] of [
		[0, 0],
		[4294967295, 65535],
	]) {
		expect(decodeVoiceEvent("v1", { ...frame, sample_rate: sampleRate, channels: numChannels })).toEqual({
			kind: "audio",
			data: frame.delta,
			sampleRate,
			numChannels,
		});
	}
});
test("v3 uses its fixed format and ignores optional v1/v2 metadata", () => {
	expect(
		decodeVoiceEvent("v3", {
			type: "output_audio.delta",
			audio: frame.delta,
			sample_rate: 48000,
			channels: 2,
			samples_per_channel: 120,
			item_id: "ignored-by-v3",
		}),
	).toEqual({ kind: "audio", data: frame.delta, sampleRate: 24000, numChannels: 1 });
});

test.each(["v1", "v3"] as const)(
	"%s forwards audio without persisting it and ignores frames after closure",
	async version => {
		let handlers!: VoiceHandlers;
		const events: { method: string; params: Record<string, unknown> }[] = [];
		const records: Record<string, unknown>[] = [];
		let executions = 0;
		const voice = new NativeVoice({
			authenticate: async () => ({ accessToken: "fixture-access", accountId: "example-voice-account" }),
			open: async (_url, _headers, value) => {
				handlers = value;
				return { send() {}, close() {}, bufferedAmount: 0 };
			},
			emit: (method, params) => {
				events.push({ method, params });
			},
			records: () => records,
			record: async record => {
				records.push(record);
			},
			delegate: async () => {
				executions++;
				return "unexpected";
			},
		});
		await voice.start({
			version,
			transport: { type: "existingCall", callId: "audio-fixture" },
			outputModality: "audio",
			includeStartupContext: false,
		});
		const payload = JSON.stringify(
			version === "v1" ? { ...frame, samples_per_channel: 120 } : { type: "output_audio.delta", audio: frame.delta },
		);
		try {
			handlers.message(payload);
			for (
				let attempt = 0;
				attempt < 100 && !events.some(event => event.method === "thread/realtime/outputAudio/delta");
				attempt++
			)
				await Bun.sleep(1);
			expect(events.filter(event => event.method === "thread/realtime/outputAudio/delta")).toHaveLength(1);
			expect(events.find(event => event.method === "thread/realtime/outputAudio/delta")?.params).toEqual({
				audio: {
					data: frame.delta,
					sampleRate: 24000,
					numChannels: 1,
					samplesPerChannel: version === "v1" ? 120 : null,
					itemId: null,
				},
			});
			await voice.stop();
			const count = events.length;
			handlers.message(payload);
			await Bun.sleep(10);
			expect(events.length).toBe(count);
			expect(JSON.stringify(records)).not.toContain(frame.delta);
			expect(executions).toBe(0);
		} finally {
			await voice.stop();
		}
	},
);
