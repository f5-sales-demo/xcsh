import { NativeVoice, type VoiceDependencies } from "./remote-control/voice";
import type { VoiceHandlers } from "./remote-control/voice-socket";

const exchanges = [
	"Who are you? I’m ek-see-shell.",
	"Hi ChatGPT, Hey! What would you like to work on?",
	"Hey ChatGPT, please make a plan. I’ll wait for your go-ahead.",
	"What What can you do? I’m ChatGPT. I can help write or code.",
];

/** Exercise the packaged voice runtime without a provider, microphone, or user operation. */
export async function runVoiceStartupSmoke(): Promise<{ rejectedExchanges: number; callerDelegations: number }> {
	let rejectedExchanges = 0;
	let callerDelegations = 0;
	for (const text of [...exchanges, "Hi there."]) {
		let handlers!: VoiceHandlers;
		const records: Record<string, unknown>[] = [];
		const terminalReasons: unknown[] = [];
		let closed = 0;
		let delegated = 0;
		let complete!: () => void;
		const completed = new Promise<void>(resolve => {
			complete = resolve;
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
						if (JSON.parse(data).type === "session.context.append")
							queueMicrotask(() =>
								next.message(JSON.stringify({ type: "session.context.appended", start_ms: 0, end_ms: 1 })),
							);
					},
					close: () => {
						closed++;
					},
					bufferedAmount: 0,
				};
			},
			emit: (method, params) => {
				if (method === "thread/realtime/closed") {
					terminalReasons.push(params.reason);
					complete();
				}
			},
			records: () => records,
			record: async record => {
				records.push(record);
				if (record.kind === "delegationResult") complete();
			},
			delegate: async () => {
				delegated++;
				return "verified";
			},
		};
		const voice = new NativeVoice(deps);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await voice.start({
				version: "v3",
				outputModality: "audio",
				includeStartupContext: false,
				transport: { type: "existingCall", callId: "example-call" },
			});
			const receive = (event: unknown) => handlers.message(JSON.stringify(event));
			const caller = text === "Hi there.";
			if (caller) receive({ type: "input_transcript.added", item: { text: "List the project files" } });
			receive({ type: "output_transcript.added", item: { text } });
			receive({ type: "turn.done", turn: { role: "assistant", transcript: text, id: "startup" } });
			receive({
				type: "delegation.created",
				item: {
					type: "delegation",
					target: "client",
					id: "startup-task",
					content: [{ type: "input_text", text: "List the project files" }],
				},
			});
			await Promise.race([
				completed,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error("Packaged startup replay did not settle")), 5000);
				}),
			]);
			clearTimeout(timer);
			await voice.closing;
			await voice.stop();
			await voice.stop();
			const violations = records.filter(record => record.kind === "startupPolicyViolation");
			if (caller) {
				if (
					delegated !== 1 ||
					violations.length ||
					terminalReasons.length !== 1 ||
					terminalReasons[0] !== "requested"
				)
					throw new Error("Packaged startup policy rejected a real caller");
				callerDelegations++;
			} else {
				if (
					delegated ||
					records.some(record => record.kind === "delegation") ||
					violations.length !== 1 ||
					terminalReasons.length !== 1 ||
					terminalReasons[0] !== "failed" ||
					closed !== 1
				)
					throw new Error("Packaged startup violation did not fail without execution");
				rejectedExchanges++;
			}
		} finally {
			clearTimeout(timer);
			await voice.stop();
		}
	}
	return { rejectedExchanges, callerDelegations };
}

/** A caller turn must not disable product identity enforcement. */
export async function runRequestedVoiceIdentitySmoke(): Promise<{
	wrongIdentityRejected: number;
	correctIdentityAccepted: number;
	partialSpeechPreserved: number;
}> {
	let wrongIdentityRejected = 0,
		correctIdentityAccepted = 0,
		partialSpeechPreserved = 0;
	for (const correct of [false, true]) {
		let handlers!: VoiceHandlers;
		const records: Record<string, any>[] = [];
		let delegated = 0;
		const voice = new NativeVoice({
			authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-account" }),
			open: async (_url, _headers, next) => {
				handlers = next;
				queueMicrotask(() =>
					next.message(JSON.stringify({ type: "session.started", session: { id: "example-session" } })),
				);
				return {
					send(data) {
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
						if (JSON.parse(data).type === "session.context.append")
							queueMicrotask(() =>
								next.message(JSON.stringify({ type: "session.context.appended", start_ms: 0, end_ms: 1 })),
							);
					},
					close() {},
					bufferedAmount: 0,
				};
			},
			records: () => records,
			record: async r => {
				records.push(r);
			},
			emit() {},
			delegate: async () => {
				delegated++;
				return "verified";
			},
		});
		try {
			await voice.start({
				version: "v3",
				outputModality: "audio",
				includeStartupContext: false,
				transport: { type: "existingCall", callId: "example-call" },
			});
			const receive = (event: unknown) => handlers.message(JSON.stringify(event));
			receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
			if (correct)
				receive({
					type: "turn.done",
					turn: { role: "assistant", transcript: "I’m ek-see-shell.", id: "requested-identity" },
				});
			else {
				receive({ type: "output_transcript.added", item: { text: " I’m Chat" } });
				receive({ type: "output_transcript.added", item: { text: "GPT. I can help with ideas." } });
			}
			await Bun.sleep(0);
			await voice.stop();
			await voice.closing;
			const violations = records.filter(r => r.kind === "startupPolicyViolation");
			if (delegated) throw new Error("Identity check executed backend work");
			if (correct) {
				if (violations.length) throw new Error("Correct identity rejected");
				correctIdentityAccepted++;
			} else {
				if (violations.length !== 1 || violations[0].reason !== "identity-mismatch")
					throw new Error("Requested ChatGPT identity was accepted");
				const partial = records.find(
					r => r.kind === "voiceTimeline" && r.item.type === "transcriptSegment" && r.item.role === "assistant",
				);
				if (!partial?.item.text.includes("ChatGPT")) throw new Error("Partial identity evidence lost");
				wrongIdentityRejected++;
				partialSpeechPreserved++;
			}
		} finally {
			await voice.stop();
		}
	}
	return { wrongIdentityRejected, correctIdentityAccepted, partialSpeechPreserved };
}
