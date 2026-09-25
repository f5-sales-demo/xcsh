import { expect, spyOn, test } from "bun:test";
import { Settings } from "../../src/config/settings";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import { NativeVoice } from "../../src/remote-control/voice";
import type { AgentSessionEvent } from "../../src/session/agent-session";
import type { RecapRecord } from "../../src/session/recap";

test("remote recap read, generation, and event share the persisted recap ID", async () => {
	const recap: RecapRecord = {
		id: "recap-1",
		sessionId: "session-1",
		trigger: "manual",
		summary: "Goal remains open",
		nextAction: "Validate the worker",
		completedTurnCount: 3,
		createdAt: "2026-09-25T00:00:00.000Z",
	};
	let listener: ((event: AgentSessionEvent) => void) | undefined;
	const target = {
		sessionId: "session-1",
		sessionFile: "/tmp/session-1.jsonl",
		sessionName: "recap",
		model: undefined,
		messages: [],
		isStreaming: false,
		settings: Settings.isolated({ "sandbox.enabled": false }),
		sessionManager: { getCwd: () => "/tmp", getBranch: () => [] },
		subscribe: (fn: (event: AgentSessionEvent) => void) => {
			listener = fn;
			return () => {};
		},
		getRecaps: () => [recap],
		generateRecap: async () => recap,
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	remote.subscribe(event => events.push(event));
	const voiceStart = spyOn(NativeVoice.prototype, "start").mockResolvedValue();
	const voiceStop = spyOn(NativeVoice.prototype, "stop").mockResolvedValue();
	const spoken: string[] = [];
	const mirror = spyOn(NativeVoice.prototype, "mirrorText").mockImplementation(text => {
		spoken.push(text);
	});
	try {
		await remote.call("voice", "thread/realtime/start", {
			threadId: "session-1",
			version: "v3",
			transport: { type: "existingCall", callId: "fixture" },
			outputModality: "audio",
			includeStartupContext: false,
		});
		expect(await remote.call("read", "thread/recap/read", { threadId: "session-1" })).toEqual({
			recaps: [recap],
			latest: recap,
		});
		expect(await remote.call("generate", "thread/recap/generate", { threadId: "session-1" })).toEqual({ recap });
		listener?.({ type: "recap_created", recap });
		expect(spoken).toEqual([]);
		expect(events.find(event => event.method === "thread/recap/created")).toMatchObject({
			params: { id: recap.id, summary: recap.summary, sessionId: recap.sessionId },
		});
		await remote.call("voice-recap", "thread/recap/generate", { threadId: "session-1", speak: true });
		expect(spoken).toEqual(["Recap: Goal remains open Next: Validate the worker"]);
	} finally {
		remote.dispose();
		voiceStart.mockRestore();
		voiceStop.mockRestore();
		mirror.mockRestore();
	}
});
