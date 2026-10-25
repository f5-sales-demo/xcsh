import { NativeVoice } from "./remote-control/voice";
import { voicePersonaInstructions } from "./remote-control/voice-persona";
import type { VoiceHandlers } from "./remote-control/voice-socket";
import { StartupAssistantPolicy } from "./remote-control/voice-startup-policy";

/** Replay an assistant-only empty handoff; no speech, provider, or real work. */
export async function runVoiceStartupAdmissionSmoke(): Promise<{
	assistantOnlyRejected: number;
	callerAccepted: number;
	englishDefault: true;
}> {
	let assistantOnlyRejected = 0;
	let callerAccepted = 0;
	for (const text of [
		"What does that tell you?",
		"Wie geht es weiter?",
		"その話はどう思いますか？",
		"Hello.",
		"Mm-mm.",
	]) {
		let handlers!: VoiceHandlers;
		const records: Record<string, unknown>[] = [];
		let delegated = 0;
		let settle!: () => void;
		const settled = new Promise<void>(resolve => {
			settle = resolve;
		});
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
			emit() {},
			records: () => records,
			record: async r => {
				records.push(r);
				if (["delegationSuppressed", "delegationResult", "startupPolicyViolation"].includes(String(r.kind)))
					settle();
			},
			delegate: async () => {
				delegated++;
				return "verified";
			},
		});
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await voice.start({
				version: "v3",
				outputModality: "audio",
				includeStartupContext: false,
				transport: { type: "existingCall", callId: "example-call" },
			});
			const caller = text === "Hello.";
			if (caller)
				handlers.message(JSON.stringify({ type: "input_transcript.added", item: { text: "Read the project" } }));
			if (text === "Mm-mm.")
				handlers.message(JSON.stringify({ type: "output_transcript.added", item: { text: "Mm" } }));
			handlers.message(
				JSON.stringify({
					type: "turn.done",
					turn: { role: "assistant", transcript: text, id: "assistant-startup" },
				}),
			);
			const frame = JSON.stringify({
				type: "delegation.created",
				item: {
					type: "delegation",
					target: "client",
					id: "empty-handoff",
					user_bidi_turn_id: "not-proof-of-input",
					content: [{ type: "input_text", text: "" }],
				},
			});
			handlers.message(frame);
			handlers.message(frame);
			await Promise.race([
				settled,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error("Startup admission replay did not settle")), 5000);
				}),
			]);
			clearTimeout(timer);
			await voice.stop();
			if (caller) {
				if (delegated !== 1 || records.some(r => r.kind === "delegationSuppressed"))
					throw new Error("Real caller request rejected");
				callerAccepted++;
			} else {
				if (
					delegated ||
					!records.some(
						r =>
							(r.kind === "delegationSuppressed" && r.reason === "noCallerRequest") ||
							r.kind === "startupPolicyViolation",
					) ||
					records.some(r => r.kind === "delegation")
				)
					throw new Error("Assistant-only handoff admitted");
				assistantOnlyRejected++;
			}
		} finally {
			clearTimeout(timer);
			await voice.stop();
		}
	}
	const annotation = new StartupAssistantPolicy({ callerFirst: true });
	if (
		annotation.observe("assistant", " [lip", false) !== null ||
		annotation.observe("assistant", " smack]", false) !== "startup-speech"
	)
		throw new Error("Incomplete startup annotation classification");
	const sniff = new StartupAssistantPolicy({ callerFirst: true });
	if (
		sniff.observe("assistant", " [sniff]", true) !== null ||
		sniff.observe("assistant", " Hi", false) !== "startup-speech"
	)
		throw new Error("Provider annotation classification failed");
	const language = voicePersonaInstructions(
		{ prompt: "Speak another language" },
		{ history: "foreign history", tools: [], runtime: { workspace: "/tmp/" + "🌳".repeat(900) } },
	).instructions;
	if (!language.includes("Speak English unless explicitly asked to switch.") || Buffer.byteLength(language) > 4096)
		throw new Error("Compiled language policy missing or over budget");
	return { assistantOnlyRejected, callerAccepted, englishDefault: true };
}
