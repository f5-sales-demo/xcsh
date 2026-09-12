import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceOutputUpdate } from "../../src/remote-control/voice-handoff";
import itemReference from "./fixtures/codex-0.153.4-response-items.json";

// Pinned realtime_conversation.rs: handoff_out, realtime_backend_item and handle_handoff_output.
// Frames are source-contract expectations, not captured phone traffic.
function fixture(version: string, options: Record<string, unknown> = {}, transport = "existingCall") {
	const sent: any[] = [];
	const records: Record<string, unknown>[] = [];
	const jobs: { output: (update: VoiceOutputUpdate) => void; finish: (text: string) => void }[] = [];
	let receive = (_data: string) => {};
	let authenticated = 0;
	const deps: VoiceDependencies = {
		authenticate: async () => {
			authenticated++;
			return { accessToken: "fixture-key", accountId: "example-voice-account" };
		},
		createCall: async () => ({ callId: "rtc_fixture", sdp: "v=0\r\nfixture-answer" }),
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			return { send: data => sent.push(JSON.parse(data)), close: () => {}, bufferedAmount: 0 };
		},
		emit: () => {},
		records: () => records,
		record: async record => {
			records.push(record);
		},
		delegate: async (_id, _text, output) => new Promise<string>(finish => jobs.push({ output: output!, finish })),
	};
	const voice = new NativeVoice(deps);
	return {
		voice,
		sent,
		jobs,
		records,
		authenticated: () => authenticated,
		start: async () => {
			await voice.start({
				threadId: "example-thread",
				version,
				outputModality: "audio",
				includeStartupContext: false,
				codexResponsesAsItems: true,
				...options,
				transport:
					transport === "webrtc"
						? { type: transport, sdp: "v=0\r\nfixture-offer" }
						: { type: transport, callId: "rtc_fixture" },
			});
			sent.length = 0;
		},
		request: async (id = "h1") => {
			receive(
				JSON.stringify(
					version === "v1"
						? {
								type: "conversation.handoff.requested",
								handoff_id: id,
								item_id: `item-${id}`,
								input_transcript: "Fixture work",
							}
						: {
								type: "delegation.created",
								item: {
									type: "delegation",
									target: "client",
									id,
									content: [{ type: "input_text", text: "Fixture work" }],
								},
							},
				),
			);
			await Bun.sleep(0);
			return jobs.at(-1)!;
		},
		close: async () => {
			await voice.stop();
			for (const job of jobs) job.finish("");
			await Bun.sleep(0);
		},
	};
}
const item = (text: string) => ({
	type: "conversation.item.create",
	item: { type: "message", role: "developer", content: [{ type: "input_text", text }] },
});
const context = (text: string, channel?: string) => ({
	type: "session.context.append",
	...(channel ? { channel } : {}),
	content: [{ type: "input_text", text }],
});

test.each(["v1", "v3"].flatMap(version => ["webrtc", "existingCall"].map(transport => ({ version, transport }))))(
	"$version $transport emits completed response items once without delegation appends",
	async ({ version, transport }) => {
		const f = fixture(
			version,
			{ codexResponseItemPrefix: "Fixture agent", codexResponseHandoffMode: "bemTags" },
			transport,
		);
		try {
			await f.start();
			const job = await f.request();
			await f.request();
			expect(f.jobs).toHaveLength(1);
			job.output({ id: "progress", text: "[COMMENTARY]Working", phase: "final_answer", done: false });
			await Bun.sleep(210);
			expect(f.sent).toEqual([]);
			job.output({ id: "progress", text: "[COMMENTARY]Working", phase: "final_answer", done: true });
			job.output({ id: "final", text: "[FINAL]Done", phase: "commentary", done: true });
			job.output({ id: "final", text: "[FINAL]Done", done: true });
			job.finish("[FINAL]Done");
			await Bun.sleep(0);
			expect(f.sent).toEqual(
				version === "v1"
					? [item("Fixture agent\n\n[COMMENTARY]Working"), item("Fixture agent\n\n[FINAL]Done")]
					: [
							context("Fixture agent\n\n[COMMENTARY]Working", "commentary"),
							context("Fixture agent\n\n[FINAL]Done", "speakable"),
						],
			);
		} finally {
			await f.close();
		}
	},
);

test.each([
	{ mode: "thinking", text: "Done", channel: undefined },
	{ mode: "commentary", text: "Done", channel: "commentary" },
	{ mode: "bemTags", text: "[ANALYSIS]Update", channel: "commentary" },
	{ mode: "bemTags", text: "[COMMENTARY]Update", channel: "commentary" },
	{ mode: "bemTags", text: "[FINAL]Done", channel: "speakable" },
	{ mode: "bemTags", text: "Unmarked result", channel: "speakable" },
])("v3 item mode $mode routes $text before adding the prefix", async ({ mode, text, channel }) => {
	const f = fixture("v3", { codexResponseHandoffMode: mode, codexResponseItemPrefix: "[FINAL]Fixture prefix" });
	try {
		await f.start();
		(await f.request()).finish(text);
		await Bun.sleep(0);
		expect(f.sent).toEqual([context(`[FINAL]Fixture prefix\n\n${text}`, channel)]);
	} finally {
		await f.close();
	}
});

test.each([undefined, null, ""])("empty or absent response item prefix %j adds no separator", async prefix => {
	const f = fixture("v1", { codexResponseItemPrefix: prefix });
	try {
		await f.start();
		(await f.request()).finish("Done");
		await Bun.sleep(0);
		expect(f.sent).toEqual([item("Done")]);
	} finally {
		await f.close();
	}
});

test("custom BEM channels and empty overrides retain pinned routing", async () => {
	const f = fixture("v3", {
		codexResponseHandoffMode: "bemTags",
		codexResponseHandoffChannelPrefixes: { commentary: ["Working:"], analysis: [] },
	});
	try {
		await f.start();
		const job = await f.request();
		job.output({ id: "first", text: "Working: fixture", done: true });
		job.output({ id: "second", text: "[ANALYSIS]Disabled prefix", phase: "commentary", done: true });
		expect(f.sent).toEqual([
			context("Working: fixture", "commentary"),
			context("[ANALYSIS]Disabled prefix", "speakable"),
		]);
	} finally {
		await f.close();
	}
});

test.each(["v1", "v3"])(
	"%s items preserve cancellation, retire superseded work and suppress output after closure",
	async version => {
		const f = fixture(version);
		const render = version === "v1" ? item : context;
		try {
			await f.start();
			const old = await f.request();
			const current = await f.request("h2");
			old.finish("Old result");
			current.output({ id: "step", text: "First step", done: true });
			current.finish("The task was cancelled.");
			await Bun.sleep(0);
			expect(f.sent).toEqual([render("First step"), render("The task was cancelled.")]);
			const late = await f.request("h3");
			await f.voice.stop();
			const count = f.sent.length;
			late.output({ id: "late", text: "Late result", done: true });
			late.finish("Late result");
			await Bun.sleep(0);
			expect(f.sent).toHaveLength(count);
			expect(f.records.filter(record => record.kind === "delegationResult")).toHaveLength(3);
		} finally {
			await f.close();
		}
	},
);

test.each(["v1", "v3"])(
	"%s client-managed mode suppresses automatic items but permits explicit speech",
	async version => {
		const f = fixture(version, { clientManagedHandoffs: true });
		try {
			await f.start();
			(await f.request()).finish("Done");
			await Bun.sleep(0);
			expect(f.sent).toEqual([]);
			f.voice.appendText("Speak explicitly", "user", true);
			expect(f.sent).toEqual(
				version === "v1"
					? [{ type: "conversation.handoff.append", handoff_id: "codex", output_text: "Speak explicitly" }]
					: [context("Speak explicitly", "speakable")],
			);
		} finally {
			await f.close();
		}
	},
);

test.each(
	["v1", "v3"].flatMap(version => itemReference.cases.map((fixture, index) => ({ version, index, ...fixture }))),
)("$version response item matches original pinned Rust case $index", async ({ version, input, bytes, sha256 }) => {
	const prefix = input.prefix?.unit.repeat(input.prefix.count) ?? null,
		text = input.text.unit.repeat(input.text.count);
	const f = fixture(version, { codexResponseItemPrefix: prefix });
	try {
		await f.start();
		(await f.request()).finish(text);
		await Bun.sleep(0);
		const actual =
			version === "v1" ? f.sent[0].item.content[0].text : f.sent.map(frame => frame.content[0].text).join("");
		expect(Buffer.byteLength(actual)).toBe(bytes);
		expect(new Bun.CryptoHasher("sha256").update(actual).digest("hex")).toBe(sha256);
		expect(actual).not.toContain("�");
		if (version === "v3") expect(f.sent.every(frame => Buffer.byteLength(frame.content[0].text) <= 500)).toBe(true);
	} finally {
		await f.close();
	}
});

test.each(["items", "text", "cumulative"])("response-item delivery enforces its %s input bound", async bound => {
	const f = fixture("v3");
	try {
		await f.start();
		const job = await f.request();
		if (bound === "items")
			for (let index = 0; index <= 256; index++) job.output({ id: `item-${index}`, text: "Done", done: true });
		else if (bound === "text") job.output({ id: "large", text: "a".repeat(1_048_577), done: true });
		else {
			for (const id of ["first", "second"]) job.output({ id, text: "a".repeat(1_048_576), done: true });
			job.output({ id: "third", text: "Overflow", done: true });
		}
		expect(f.voice.active).toBe(false);
		expect(f.sent.every(frame => frame.type === "session.context.append")).toBe(true);
	} finally {
		await f.close();
	}
});

test.each(["v1", "v3"])("%s response items preserve whitespace in completed agent text", async version => {
	const f = fixture(version);
	try {
		await f.start();
		const job = await f.request();
		job.output({ id: "whitespace", text: " \n\t", done: true });
		job.finish(" \n\t");
		await Bun.sleep(0);
		expect(f.voice.active).toBe(true);
		expect(f.sent).toEqual([version === "v1" ? item(" \n\t") : context(" \n\t")]);
	} finally {
		await f.close();
	}
});

test.each(["v1", "v3"].flatMap(version => ["", "Fixture prefix"].map(prefix => ({ version, prefix }))))(
	"$version completed empty items retain prefix $prefix once",
	async ({ version, prefix }) => {
		const f = fixture(version, { codexResponseItemPrefix: prefix });
		try {
			await f.start();
			const job = await f.request();
			job.output({ id: "empty", text: "", done: true });
			job.output({ id: "empty", text: "", done: true });
			job.finish("");
			await Bun.sleep(0);
			const text = prefix ? `${prefix}\n\n` : "";
			expect(f.sent).toEqual([version === "v1" ? item(text) : context(text)]);
		} finally {
			await f.close();
		}
	},
);

test.each(["webrtc", "existingCall"])(
	"%s rejects malformed response-item options before authentication",
	async transport => {
		for (const options of [
			{ codexResponsesAsItems: "true" },
			{ codexResponsesAsItems: 1 },
			{ codexResponseItemPrefix: 42 },
			{ codexResponseItemPrefix: {} },
		]) {
			const f = fixture("v3", options, transport);
			try {
				await expect(f.start()).rejects.toMatchObject({ code: -32602 });
				expect(f.authenticated()).toBe(0);
			} finally {
				await f.close();
			}
		}
	},
);
