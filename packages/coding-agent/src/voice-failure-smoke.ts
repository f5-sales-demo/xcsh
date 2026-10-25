import { NativeVoice } from "./remote-control/voice";

export async function runVoiceFailureSmoke() {
	const records: any[] = [];
	const events: string[] = [];
	let admitted = 0;
	let receive = (_event: string) => {};
	let instructionAppends = 0;
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "synthetic", accountId: "example-account" }),
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			queueMicrotask(() => receive(JSON.stringify({ type: "session.started", session: { id: "fixture" } })));
			return {
				bufferedAmount: 0,
				close() {},
				send(data: string) {
					const frame = JSON.parse(data);
					if (frame.type === "session.instructions.append") {
						if (
							typeof frame.content !== "string" ||
							!frame.content.startsWith("You are xcsh") ||
							frame.content.length > 2200
						)
							throw new Error("Unexpected instruction append");
						instructionAppends++;
					}
				},
			};
		},
		records: () => records,
		record: async row => {
			records.push(row);
			events.push(`persist:${row.kind}:${(row.item as { type?: string } | undefined)?.type}`);
		},
		emit: method => events.push(method),
		delegate: async () => {
			admitted++;
			return "unexpected";
		},
	});
	try {
		await voice.start({
			version: "v3",
			outputModality: "audio",
			includeStartupContext: false,
			realtimeSessionId: "failed-physical-fixture",
			transport: { type: "existingCall", callId: "fixture" },
		});
		if (instructionAppends !== 0) throw new Error("Subscription attachment mutated instructions");
		receive(
			JSON.stringify({
				type: "error",
				error: { type: "invalid_request_error", code: "invalid_value", param: "content" },
			}),
		);
		await new Promise(resolve => setTimeout(resolve, 10));
	} catch {
		await voice.closing;
	}
	await voice.stop();
	const lifecycle = records.filter(row => row.kind === "voiceTimeline").map(row => row.item);
	const closures = events.filter(name => name === "thread/realtime/closed").length;
	const failedLifecyclePersisted =
		lifecycle.length === 2 &&
		lifecycle[0].type === "realtimeSessionStarted" &&
		lifecycle[1].type === "realtimeSessionClosed" &&
		lifecycle[1].outcome === "failed" &&
		events.indexOf("persist:voiceTimeline:realtimeSessionClosed") < events.indexOf("thread/realtime/closed");
	if (!failedLifecyclePersisted || closures !== 1 || admitted !== 0 || !events.includes("thread/realtime/started"))
		throw new Error("Incomplete failed-provider lifecycle");
	return { failedLifecyclePersisted, closures, admissions: admitted };
}
