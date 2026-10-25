import { NativeVoice } from "./remote-control/voice";
import type { VoiceHandlers } from "./remote-control/voice-socket";

/** Packaged evidence of compiled cue delivery, not a claim about generated audio. */
export async function runVoicePronunciationSmoke(): Promise<{
	handoffPaths: number;
	exactResultsPreserved: number;
	speechProjections: number;
}> {
	let exactResultsPreserved = 0;
	for (const asItems of [false, true]) {
		let handlers!: VoiceHandlers;
		let finish!: (text: string) => void;
		let ready!: () => void;
		const delivered = new Promise<void>(resolve => {
			ready = resolve;
		});
		const sent: Record<string, any>[] = [];
		let admissions = 0;
		const voice = new NativeVoice({
			authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-account" }),
			open: async (_url, _headers, next) => {
				handlers = next;
				queueMicrotask(() =>
					next.message(JSON.stringify({ type: "session.started", session: { id: "example-session" } })),
				);
				return {
					send(data) {
						const frame = JSON.parse(data);
						sent.push(frame);
						if (
							JSON.parse(data).type === "session.context.append" &&
							JSON.parse(data).content?.[0]?.text?.startsWith("You are xcsh")
						)
							queueMicrotask(() =>
								next.message(
									JSON.stringify({
										type: "session.context.appended",
										client_event_id: JSON.parse(data).event_id,
										start_ms: 0,
										end_ms: 1,
									}),
								),
							);
						if (frame.type === "session.context.append")
							queueMicrotask(() =>
								next.message(JSON.stringify({ type: "session.context.appended", start_ms: 0, end_ms: 1 })),
							);
						if (frame.type === "delegation.context.append" || frame.channel === "speakable") ready();
					},
					close() {},
					bufferedAmount: 0,
				};
			},
			record: async () => {},
			records: () => [],
			emit() {},
			delegate: async () => {
				admissions++;
				return new Promise<string>(resolve => {
					finish = resolve;
				});
			},
		});
		try {
			await voice.start({
				version: "v3",
				outputModality: "audio",
				includeStartupContext: false,
				codexResponsesAsItems: asItems,
				codexResponseHandoffMode: "bemTags",
				transport: { type: "existingCall", callId: "example-call" },
			});
			handlers.message(JSON.stringify({ type: "input_transcript.added", item: { text: "Read the result" } }));
			handlers.message(
				JSON.stringify({
					type: "delegation.created",
					item: {
						type: "delegation",
						target: "client",
						id: "example-result",
						content: [{ type: "input_text", text: "Read the result" }],
					},
				}),
			);
			await Bun.sleep(0);
			const result =
				'Updated by xcsh voice qualification. Exact resource: `xcsh-demo-lb`. Code: `const xcsh = "xcsh";`';
			finish(result);
			await delivered;
			await Bun.sleep(0);
			const frames = sent.filter(
				frame => frame.type === "delegation.context.append" || frame.channel === "speakable",
			);
			const text = frames.flatMap(frame => frame.content.map((part: any) => part.text)).join("");
			if (
				!text.startsWith('Product pronunciation: xcsh is "ek-see-shell"') ||
				!text.includes("Updated by ek-see-shell voice qualification.") ||
				!text.endsWith('Code: `const xcsh = "xcsh";`') ||
				text.includes("ek-see-shell-demo-lb") ||
				admissions !== 1 ||
				frames.some(frame => frame.content.some((part: any) => Buffer.byteLength(part.text) > 500))
			)
				throw new Error("Packaged pronunciation cue or exact result missing");
			exactResultsPreserved++;
		} finally {
			await voice.stop();
		}
	}
	return { handoffPaths: 2, exactResultsPreserved, speechProjections: 2 };
}
