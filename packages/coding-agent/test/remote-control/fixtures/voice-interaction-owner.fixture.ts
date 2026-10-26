import { expect, mock, test } from "bun:test";
import { ConversationPlans, type PlanAction } from "../../../../chat-ui/src/interactions/conversation-plan";
import { Settings } from "../../../src/config/settings";
import type { SessionTarget } from "../../../src/remote-control/session";
import { SessionManager } from "../../../src/session/session-manager";
import { UserInteractions } from "../../../src/session/user-interactions";

// Isolated child fixture: only provider transport is replaced; admission and answer owners are real.
let voice: FixtureVoice;
class FixtureVoice {
	active = false;
	ownedCall = true;
	canReleaseAudioOwnership = true;
	constructor(
		readonly options: {
			completedTranscript(role: "user" | "assistant", text: string): boolean;
			delegate(id: string, text: string): Promise<string>;
			emit(method: string, params: Record<string, unknown>): void;
		},
	) {
		voice = this;
	}
	async start(params: Record<string, unknown>) {
		expect(params.model).toBe("gpt-live-1");
		this.active = true;
	}
	async stop() {
		this.active = false;
		this.options.emit("thread/realtime/closed", { reason: "requested" });
	}
	async refreshContext() {}
	mirrorText() {}
}
mock.module("../../../src/remote-control/voice", () => ({ NativeVoice: FixtureVoice }));
const { RemoteSession } = await import("../../../src/remote-control/session");

async function fixture(secret = false, planMode = false) {
	const manager = SessionManager.inMemory("/fixture/workspace");
	const broker = new UserInteractions();
	const plans = new ConversationPlans();
	const decisions: PlanAction[] = [];
	const backendRequests: string[] = [];
	const target = {
		sessionId: manager.getSessionId(),
		model: { provider: "openai-codex", id: "gpt-6-astra" },
		messages: [],
		settings: Settings.isolated({ "compaction.enabled": false }),
		sessionManager: manager,
		userInteractions: broker,
		conversationPlans: plans,
		decidePlan: async (id: string, action: PlanAction) => {
			const selection = plans.decide(id, action);
			if (selection) decisions.push(action);
			return { accepted: !!selection };
		},
		modelRegistry: { authStorage: {} },
		subscribe: () => () => {},
		abort: async () => {},
		prompt: async (text: string) => {
			backendRequests.push(text);
			throw new Error("Backend execution is excluded from this interaction fixture");
		},
		setRealtimeMode: () => {},
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	const events: { method: string; params: Record<string, unknown> }[] = [];
	remote.subscribe(event => events.push(event));
	await remote.call("activate", "thread/realtime/start", {
		threadId: target.sessionId,
		version: "v3",
		model: "gpt-live-1",
		transport: { type: "webrtc", sdp: "v=0\r\nfixture" },
	});
	const identity = {
		sessionId: target.sessionId,
		threadId: target.sessionId,
		turnId: "turn",
		itemId: "item",
		generation: 1,
	};
	const resolved: unknown[] = [];
	broker.subscribe(event => {
		if (event.type === "resolved") resolved.push(event);
	});
	const plan = planMode ? plans.complete("plan", "<proposed_plan>\n# Fixture plan\n</proposed_plan>") : undefined;
	const result = plan
		? Promise.resolve(undefined)
		: broker.request({
				kind: "select",
				title: "Choose the fixture scope",
				options: ["Alpha", "Beta"],
				delivery: "async",
				identity,
				isSecret: secret,
			});
	const request = plan ?? broker.pending()[0]!;
	voice.options.completedTranscript("assistant", plan ? "Fixture plan?" : "Choose the fixture scope?");
	const playback = await remote.call("played", "xcsh/voice/playback", {
		threadId: target.sessionId,
		announcementId: request.id,
		announcementRevision: plan?.revision ?? broker.snapshot().revision,
	});
	const ui = async () =>
		(await remote.call("ui-answer", "xcsh/interaction", {
			threadId: target.sessionId,
			command: plan
				? { type: "plan_decide", planId: plan.id, action: "implement", responseId: "ui-plan-response" }
				: {
						type: "interaction_respond",
						requestId: request.id,
						responseId: "ui-response",
						identity,
						value: "Beta",
					},
		})) as { accepted: boolean };
	return {
		remote,
		broker,
		result,
		resolved,
		playback,
		plans,
		decisions,
		backendRequests,
		events,
		ui,
		speech: () => voice.options.completedTranscript("user", plan ? "yes" : "Beta"),
		close: async () => {
			broker.cancelAll();
			await remote.close();
		},
	};
}
test.each(["ui", "speech"] as const)(
	"%s winning a concurrent answer resolves the actual owner exactly once",
	async first => {
		const f = await fixture();
		try {
			expect(f.playback).toEqual({ accepted: true });
			const ui = () => f.ui().then(value => value.accepted);
			const speech = async () => f.speech();
			const operations = first === "ui" ? [ui, speech] : [speech, ui];
			const answers = await Promise.all(operations.map(operation => Promise.resolve().then(operation)));
			expect(answers).toEqual([true, false]);
			expect(await f.result).toBe("Beta");
			expect(f.resolved).toHaveLength(1);
			expect(f.broker.pending()).toEqual([]);
		} finally {
			await f.close();
		}
	},
);
test("secret prompts remain UI-only through the session voice callback", async () => {
	const f = await fixture(true);
	try {
		expect(f.playback).toEqual({ accepted: false });
		expect(f.speech()).toBe(false);
		expect(f.broker.pending()).toHaveLength(1);
		expect(await f.ui()).toEqual({ accepted: true });
		expect(await f.result).toBe("Beta");
		expect(f.resolved).toHaveLength(1);
	} finally {
		await f.close();
	}
});

test("async input exposes its current announcement identity to the audio client", async () => {
	const f = await fixture();
	try {
		const request = f.broker.pending()[0]!;
		expect(f.events).toContainEqual(
			expect.objectContaining({
				method: "xcsh/voice/interaction",
				params: expect.objectContaining({ requestId: request.id, revision: f.broker.snapshot().revision }),
			}),
		);
	} finally {
		await f.close();
	}
});
test("a closed audio lease cannot accept late playback or a late caller answer", async () => {
	const f = await fixture();
	try {
		const closedVoice = voice;
		await closedVoice.stop();
		const request = f.broker.pending()[0]!;
		expect(
			await f.remote.call("late-playback", "xcsh/voice/playback", {
				threadId: f.remote.target.sessionId,
				announcementId: request.id,
				announcementRevision: f.broker.snapshot().revision,
			}),
		).toEqual({ accepted: false });
		expect(closedVoice.options.completedTranscript("user", "Beta")).toBe(false);
		expect(f.broker.pending()).toHaveLength(1);
		expect(await f.ui()).toEqual({ accepted: true });
		expect(await f.result).toBe("Beta");
	} finally {
		await f.close();
	}
});

test("a fresh voice activation does not inherit the previous microphone mute", async () => {
	const f = await fixture();
	try {
		const threadId = f.remote.target.sessionId;
		await f.remote.call("mute", "xcsh/voice/control", { threadId, action: "mute" });
		await voice.stop();
		await f.remote.call("restart", "thread/realtime/start", {
			threadId,
			version: "v3",
			model: "gpt-live-1",
			transport: { type: "webrtc", sdp: "v=0\r\nfixture" },
		});
		voice.options.completedTranscript("assistant", "Choose the fixture scope?");
		const request = f.broker.pending()[0]!;
		expect(
			await f.remote.call("played-again", "xcsh/voice/playback", {
				threadId,
				announcementId: request.id,
				announcementRevision: f.broker.snapshot().revision,
			}),
		).toEqual({ accepted: true });
		expect(f.speech()).toBe(true);
		expect(await f.result).toBe("Beta");
	} finally {
		await f.close();
	}
});

test("a new call cannot reuse an announcement played by the previous call", async () => {
	const f = await fixture();
	try {
		await voice.stop();
		await f.remote.call("restart", "thread/realtime/start", {
			threadId: f.remote.target.sessionId,
			version: "v3",
			model: "gpt-live-1",
			transport: { type: "webrtc", sdp: "v=0\r\nfixture" },
		});
		expect(f.speech()).toBe(false);
		expect(f.broker.pending()).toHaveLength(1);
		expect(await f.ui()).toEqual({ accepted: true });
		expect(await f.result).toBe("Beta");
	} finally {
		await f.close();
	}
});

test.each(["ui", "speech"] as const)("%s winning a plan decision resolves the current plan once", async first => {
	const f = await fixture(false, true);
	try {
		expect(f.playback).toEqual({ accepted: true });
		const ui = () => f.ui().then(value => value.accepted);
		const speech = async () => f.speech();
		const operations = first === "ui" ? [ui, speech] : [speech, ui];
		expect(await Promise.all(operations.map(operation => Promise.resolve().then(operation)))).toEqual([true, false]);
		expect(f.plans.current?.status).toBe("resolved");
		expect(f.decisions).toEqual(["implement"]);
	} finally {
		await f.close();
	}
});
test("replacing an announced plan rejects both stale speech and UI decisions", async () => {
	const f = await fixture(false, true);
	try {
		f.plans.complete("revised", "<proposed_plan>\n# Revised fixture plan\n</proposed_plan>");
		expect(f.speech()).toBe(false);
		expect(await f.ui()).toEqual({ accepted: false });
		expect(f.decisions).toEqual([]);
		expect(f.plans.current?.status).toBe("pending");
	} finally {
		await f.close();
	}
});

test.each([false, true])(
	"an early provider delegation cannot replace a completed caller decision (plan=%s)",
	async plan => {
		const f = await fixture(false, plan);
		try {
			await voice.options
				.delegate("early-provider-handoff", "<realtime_delegation>\n<input>Beta</input>\n</realtime_delegation>")
				.catch(() => "");
			expect(f.backendRequests).toEqual([]);
			expect(f.speech()).toBe(true);
			if (!plan) expect(await f.result).toBe("Beta");
			else expect(f.decisions).toEqual(["implement"]);
		} finally {
			await f.close();
		}
	},
);
