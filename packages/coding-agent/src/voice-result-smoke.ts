import { NativeVoice, type VoiceDependencies } from "./remote-control/voice";
import type { VoiceHandlers } from "./remote-control/voice-socket";

/** Replay the captured backend/speech mismatch through the packaged existing-call runtime. */
export async function runVoiceResultSmoke(): Promise<{
	handoffPaths: number;
	omissionsDetected: number;
	multiSegmentMatches: number;
}> {
	let omissionsDetected = 0;
	let multiSegmentMatches = 0;
	for (const asItems of [false, true]) {
		for (const segmented of [false, true]) {
			let handlers!: VoiceHandlers;
			const records: Record<string, unknown>[] = [];
			const sent: Record<string, any>[] = [];
			let calls = 0;
			let resultReady!: () => void;
			let observed!: () => void;
			const ready = new Promise<void>(resolve => {
				resultReady = resolve;
			});
			const observation = new Promise<void>(resolve => {
				observed = resolve;
			});
			const deps: VoiceDependencies = {
				authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-account" }),
				open: async (_url, _headers, next) => {
					handlers = next;
					queueMicrotask(() =>
						next.message(JSON.stringify({ type: "session.started", session: { id: "example-session" } })),
					);
					return {
						send: data => {
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
							if (frame.channel === "speakable") resultReady();
						},
						close() {},
						bufferedAmount: 0,
					};
				},
				emit() {},
				records: () => records,
				record: async record => {
					records.push(record);
					if (record.kind === "voiceResultFidelity") observed();
				},
				delegate: async () => {
					calls++;
					return "- `arithmetic.test.ts`\n- `package.json`\n- `README.md`";
				},
			};
			const voice = new NativeVoice(deps);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await voice.start({
					version: "v3",
					outputModality: "audio",
					includeStartupContext: false,
					codexResponsesAsItems: asItems,
					codexResponseHandoffMode: "bemTags",
					transport: { type: "existingCall", callId: "example-call" },
				});
				handlers.message(
					JSON.stringify({ type: "input_transcript.added", item: { text: "What files are in this project?" } }),
				);
				handlers.message(
					JSON.stringify({
						type: "delegation.created",
						item: {
							type: "delegation",
							target: "client",
							id: "example-list",
							content: [{ type: "input_text", text: "What files are in this project?" }],
						},
					}),
				);
				const replay = async () => {
					await ready;
					const text = sent.find(frame => frame.channel === "speakable")?.content?.[0]?.text;
					if (!text?.includes('Exact identifiers: ["arithmetic.test.ts","package.json","README.md"]'))
						throw new Error("Packaged list handoff lost exact identifiers");
					if (segmented) {
						for (const [id, transcript] of [
							["a", "arithmetic dot test dot ts,"],
							["b", "package dot json,"],
							["c", "README dot md."],
						])
							handlers.message(
								JSON.stringify({ type: "turn.done", turn: { role: "assistant", id, transcript } }),
							);
					} else
						handlers.message(
							JSON.stringify({
								type: "turn.done",
								turn: {
									role: "assistant",
									id: "example-answer",
									transcript: "I see arithmetic test, package, and readme.",
								},
							}),
						);
					await voice.stop();
					await observation;
				};
				await Promise.race([
					replay(),
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(() => reject(new Error("Packaged list replay did not settle")), 5000);
					}),
				]);
				const result = records.find(record => record.kind === "voiceResultFidelity");
				if (
					calls !== 1 ||
					result?.outcome !== (segmented ? "matched" : "omitted") ||
					result.missingCount !== (segmented ? 0 : 3) ||
					voice.active
				)
					throw new Error("Packaged list omission was not recorded without replay");
				if (segmented) multiSegmentMatches++;
				else omissionsDetected++;
			} finally {
				clearTimeout(timer);
				await voice.stop();
			}
		}
	}
	return { handoffPaths: 2, omissionsDetected, multiSegmentMatches };
}
