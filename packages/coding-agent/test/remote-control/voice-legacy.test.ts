import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceOutputUpdate } from "../../src/remote-control/voice-handoff";
import completedReference from "./fixtures/codex-0.153.4-completed-output.json";

const finalPrefix = '"Agent Final Message":\n\n';
const append = (text: string, id = "h1") => ({
	type: "conversation.handoff.append",
	handoff_id: id,
	output_text: text,
});

async function fixture(clientManagedHandoffs = false, version = "v1") {
	const sent: any[] = [];
	const jobs: { output: (update: VoiceOutputUpdate) => void; finish: (text: string) => void }[] = [];
	let receive = (_data: string) => {};
	const records: Record<string, unknown>[] = [];
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "fixture-key", accountId: "example-voice-account" }),
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
	await voice.start({
		transport: { type: "existingCall", callId: "fixture" },
		version,
		outputModality: "audio",
		includeStartupContext: false,
		clientManagedHandoffs,
		codexResponseHandoffMode: "bemTags",
	});
	return {
		voice,
		sent,
		jobs,
		records,
		request: async (id = "h1") => {
			receive(
				JSON.stringify({
					type: "conversation.handoff.requested",
					handoff_id: id,
					item_id: `item-${id}`,
					input_transcript: "Fixture work",
				}),
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

test("legacy output forwards completed commentary and final items once, ignoring v3 routing mode", async () => {
	const f = await fixture();
	try {
		const job = await f.request();
		job.output({ id: "progress", text: "Working", phase: "commentary", done: false });
		job.output({ id: "final", text: "Done", phase: "final_answer", done: false });
		expect(f.sent).toEqual([]);
		job.output({ id: "progress", text: "Working now", phase: "commentary", done: true });
		expect(f.sent).toEqual([append("Working now")]);
		job.output({ id: "final", text: "Done", phase: "final_answer", done: true });
		job.output({ id: "final", text: "Done", phase: "final_answer", done: true });
		job.finish("Done");
		await Bun.sleep(0);
		expect(f.sent).toEqual([append("Working now"), append(`${finalPrefix}Done`)]);
	} finally {
		await f.close();
	}
});

test("legacy completion retains a cancellation result after a completed agent item", async () => {
	const f = await fixture();
	try {
		const job = await f.request();
		job.output({ id: "first", text: "First step done", done: true });
		job.finish("The task was cancelled.");
		await Bun.sleep(0);
		expect(f.sent).toEqual([
			append(`${finalPrefix}First step done`),
			append(`${finalPrefix}The task was cancelled.`),
		]);
	} finally {
		await f.close();
	}
});

test("legacy completion does not repeat or promote its last commentary", async () => {
	const f = await fixture();
	try {
		const job = await f.request();
		job.output({ id: "progress", text: "Waiting for your answer", phase: "commentary", done: true });
		job.finish("Waiting for your answer");
		await Bun.sleep(0);
		expect(f.sent).toEqual([append("Waiting for your answer")]);
	} finally {
		await f.close();
	}
});

test("a newer legacy handoff retires older output while backing work still settles", async () => {
	const f = await fixture();
	try {
		const old = await f.request();
		const current = await f.request("h2");
		old.output({ id: "late", text: "Old result", done: true });
		old.finish("Old result");
		current.finish("Current result");
		await Bun.sleep(0);
		expect(f.sent).toEqual([append(`${finalPrefix}Current result`, "h2")]);
		expect(f.records.filter(record => record.kind === "delegationResult")).toHaveLength(2);
	} finally {
		await f.close();
	}
});

test("client-managed legacy output is suppressed but explicit speech remains available", async () => {
	const f = await fixture(true);
	try {
		const job = await f.request();
		job.output({ id: "progress", text: "Working", phase: "commentary", done: true });
		job.finish("Done");
		await Bun.sleep(0);
		expect(f.sent).toEqual([]);
		f.voice.appendText("Speak this", "user", true);
		expect(f.sent).toEqual([append("Speak this", "codex")]);
	} finally {
		await f.close();
	}
});

test.each(["v1", "v3"])("explicit %s speech obeys the pinned completed-output budget", async version => {
	const f = await fixture(false, version);
	try {
		f.voice.appendText("🌳".repeat(2000), "user", true);
		const text = version === "v1" ? f.sent[0].output_text : f.sent.map(frame => frame.content[0].text).join("");
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4000);
		expect(text).toContain("tokens truncated");
		expect(text).not.toContain("�");
	} finally {
		await f.close();
	}
});

test.each(["v1", "v3"])("empty explicit %s speech is a no-op", async version => {
	const f = await fixture(false, version);
	try {
		f.voice.appendText(" \n\t", "user", true);
		expect(f.sent).toEqual([]);
	} finally {
		await f.close();
	}
});

test.each(["v1", "v3"])("completed %s output matches the original pinned Rust truncator", async version => {
	const f = await fixture(false, version);
	try {
		for (const { input, bytes, sha256 } of completedReference.cases) {
			f.sent.length = 0;
			const text = (input.head ?? "") + input.unit.repeat(input.count) + (input.tail ?? "");
			f.voice.appendText(text, "user", true);
			const actual = version === "v1" ? f.sent[0].output_text : f.sent.map(frame => frame.content[0].text).join("");
			expect(Buffer.byteLength(actual)).toBe(bytes);
			expect(new Bun.CryptoHasher("sha256").update(actual).digest("hex")).toBe(sha256);
		}
	} finally {
		await f.close();
	}
});

test("ending legacy voice suppresses completed output without cancelling the backing result", async () => {
	const f = await fixture();
	const job = await f.request();
	await f.voice.stop();
	job.output({ id: "late", text: "Done", done: true });
	job.finish("Done");
	await Bun.sleep(0);
	expect(f.sent).toEqual([]);
	expect(f.records.some(record => record.kind === "delegationResult" && record.text === "Done")).toBe(true);
});

test.each(["items", "text"])("legacy completed output enforces its %s bound", async bound => {
	const f = await fixture();
	try {
		const job = await f.request();
		if (bound === "text") job.output({ id: "large", text: "a".repeat(1_048_577), done: true });
		else for (let index = 0; index <= 256; index++) job.output({ id: `item-${index}`, text: "done", done: true });
		expect(f.voice.active).toBe(false);
		expect(f.sent.length).toBe(bound === "text" ? 0 : 256);
	} finally {
		await f.close();
	}
});
