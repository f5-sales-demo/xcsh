import { expect, test } from "bun:test";
import { NativeVoice } from "../../src/remote-control/voice";

const start = {
	version: "v3",
	transport: { type: "existingCall", callId: "fixture" },
	outputModality: "audio",
	includeStartupContext: false,
};
function fixture(record: (record: Record<string, unknown>) => Promise<void> = async () => {}) {
	const sent: any[] = [];
	let receive = (_data: string) => {};
	let finish = (_text: string) => {};
	const finishes: Array<(text: string) => void> = [];
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "fixture", accountId: "123456789012" }),
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			return { send: data => sent.push(JSON.parse(data)), close() {}, bufferedAmount: 0 };
		},
		emit() {},
		records: () => [],
		record,
		delegate: async () =>
			new Promise<string>(resolve => {
				finish = resolve;
				finishes.push(resolve);
			}),
	});
	return {
		voice,
		sent,
		receive: (event: unknown) => receive(JSON.stringify(event)),
		finish: (text: string) => finish(text),
		finishAt: (index: number, text: string) => finishes[index](text),
	};
}

test.each(["v1", "v3"])("%s mirrors completed standalone text and respects response-item routing", async version => {
	for (const asItems of [false, true]) {
		const f = fixture();
		await f.voice.start({
			...start,
			version,
			codexResponseHandoffMode: "bemTags",
			codexResponsesAsItems: asItems,
			codexResponseItemPrefix: "PREFIX",
		});
		try {
			f.voice.mirrorText("[FINAL]Terminal result", "commentary");
			const text = asItems ? "PREFIX\n\n[FINAL]Terminal result" : "[FINAL]Terminal result";
			expect(f.sent).toEqual([
				version === "v3"
					? { type: "session.context.append", channel: "speakable", content: [{ type: "input_text", text }] }
					: asItems
						? {
								type: "conversation.item.create",
								item: { type: "message", role: "developer", content: [{ type: "input_text", text }] },
							}
						: { type: "conversation.handoff.append", handoff_id: "codex", output_text: text },
			]);
			f.voice.mirrorText(" \n\t");
			expect(f.sent).toHaveLength(1);
		} finally {
			await f.voice.stop();
		}
		const count = f.sent.length;
		f.voice.mirrorText("Late result");
		expect(f.sent).toHaveLength(count);
	}
});

test("mirrored requests follow the active delegation and revert to standalone after completion", async () => {
	const f = fixture();
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	try {
		f.receive({
			type: "delegation.created",
			item: { type: "delegation", target: "client", id: "d1", content: [{ type: "input_text", text: "Work" }] },
		});
		await Bun.sleep(0);
		f.voice.mirrorText("I need your input. Please respond in the app.");
		expect(f.sent.at(-1)).toEqual({
			type: "delegation.context.append",
			delegation_item_id: "d1",
			channel: "speakable",
			content: [{ type: "input_text", text: "I need your input. Please respond in the app." }],
		});
		f.finish("Done");
		await Bun.sleep(0);
		f.voice.mirrorText("Next terminal result");
		expect(f.sent.at(-1)).toEqual({
			type: "session.context.append",
			channel: "speakable",
			content: [{ type: "input_text", text: "Next terminal result" }],
		});
	} finally {
		await f.voice.stop();
	}
});

test("client-managed voice suppresses automatic mirrors", async () => {
	const f = fixture();
	await f.voice.start({ ...start, clientManagedHandoffs: true });
	try {
		f.voice.mirrorText("Terminal result");
		expect(f.sent).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});

test("tool-input mirrors use the pinned core event envelope and never consume the answer", async () => {
	const { UserInteractions } = await import("../../src/session/user-interactions");
	const { RemoteInteractions } = await import("../../src/remote-control/interactions");
	const { voiceInputText } = await import("../../src/remote-control/voice-input");
	const broker = new UserInteractions();
	const f = fixture();
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	const remote = new RemoteInteractions(
		broker,
		() => ({ threadId: "thread", turnId: "turn", itemId: "item" }),
		() => {},
		(request, callId) => f.voice.mirrorText(voiceInputText(request, callId)),
	);
	const result = broker.request(
		{ kind: "input", title: "What name?", toolCallId: "call" },
		() => new Promise(() => {}),
	);
	try {
		const id = broker.pending()[0].id;
		expect(f.sent).toHaveLength(1);
		expect(f.sent[0].content[0].text).toBe(
			"I need your input. Please respond in the app.\n\n" +
				JSON.stringify({
					type: "request_user_input",
					call_id: "call",
					turn_id: "turn",
					questions: [{ id, header: "Question", question: "What name?", isOther: false, isSecret: false }],
					isBlocking: true,
				}),
		);
		expect(broker.pending()).toHaveLength(1);
		expect(remote.respond(id, { answers: { [id]: { answers: ["demo-app"] } } })).toEqual({ accepted: true });
		expect(await result).toBe("demo-app");
		expect(f.sent).toHaveLength(1);
		expect(remote.respond(id, { answers: {} })).toEqual({ accepted: false });
	} finally {
		broker.cancelAll();
		remote.close();
		await f.voice.stop();
	}
});

test.each(["thinking", "commentary", "bemTags"])(
	"standalone %s routing preserves completed-output budgets",
	async mode => {
		const { completedVoiceText } = await import("../../src/remote-control/voice-legacy");
		const f = fixture();
		await f.voice.start({
			...start,
			codexResponseHandoffMode: mode,
			codexResponsesAsItems: true,
			codexResponseItemPrefix: "Prefix",
			codexResponseHandoffChannelPrefixes: { commentary: ["PROGRESS:"] },
		});
		try {
			const text = `PROGRESS:${"🌳".repeat(2500)}`;
			f.voice.mirrorText(text, "final_answer");
			expect(f.sent.every(frame => frame.type === "session.context.append")).toBe(true);
			expect(f.sent.every(frame => frame.channel === (mode === "thinking" ? undefined : "commentary"))).toBe(true);
			expect(f.sent.map(frame => frame.content[0].text).join("")).toBe(
				completedVoiceText(`Prefix\n\n${completedVoiceText(text)}`),
			);
			expect(f.sent.every(frame => Buffer.byteLength(frame.content[0].text) <= 500)).toBe(true);
		} finally {
			await f.voice.stop();
		}
	},
);

test.each([undefined, "command", "fileChange"] as const)(
	"the actual remote session forwards a %s input request without answering it",
	async kind => {
		const { spyOn } = await import("bun:test");
		const { RemoteSession } = await import("../../src/remote-control/session");
		const { SessionManager } = await import("../../src/session/session-manager");
		const { UserInteractions } = await import("../../src/session/user-interactions");
		const broker = new UserInteractions();
		const manager = SessionManager.inMemory();
		let listener = (_event: any) => {};
		const mirrored: string[] = [];
		const begin = spyOn(NativeVoice.prototype, "start").mockResolvedValue();
		const end = spyOn(NativeVoice.prototype, "stop").mockResolvedValue();
		const mirror = spyOn(NativeVoice.prototype, "mirrorText").mockImplementation(text => {
			mirrored.push(text);
		});
		const target: any = {
			sessionId: "fixture",
			getToolByName: () => ({ executionKind: kind }),
			messages: [],
			sessionManager: manager,
			userInteractions: broker,
			subscribe: (fn: typeof listener) => {
				listener = fn;
				return () => {};
			},
		};
		const remote = new RemoteSession(target);
		try {
			await remote.call("voice", "thread/realtime/start", { ...start, threadId: "fixture" });
			listener({ type: "agent_start" });
			const message: any = {
				role: "assistant",
				timestamp: 1,
				content: [{ type: "toolCall", id: "ask", name: "ask", arguments: {} }],
			};
			listener({ type: "message_end", message });
			const result = broker.request(
				{ kind: "select", title: "Choose", options: ["Alpha", "Beta"], toolCallId: "ask" },
				() => new Promise(() => {}),
			);
			expect(mirrored).toHaveLength(1);
			expect(mirrored[0]).toStartWith("I need your input. Please respond in the app.\n\n");
			expect(JSON.parse(mirrored[0].split("\n\n")[1])).toMatchObject({
				type: "request_user_input",
				call_id: "ask",
				questions: [
					{
						options: [
							{ label: "Alpha", description: "" },
							{ label: "Beta", description: "" },
						],
					},
				],
			});
			expect(remote.pendingRequests()).toHaveLength(1);
			const id = broker.pending()[0].id;
			await remote.call("answer", "session/interaction/respond", {
				threadId: "fixture",
				requestId: id,
				response: { answers: { [id]: { answers: ["Alpha"] } } },
			});
			expect(await result).toBe("Alpha");
			expect(mirrored).toHaveLength(1);
		} finally {
			broker.cancelAll();
			await remote.close();
			begin.mockRestore();
			end.mockRestore();
			mirror.mockRestore();
			await manager.close();
		}
	},
);

const work = (id: string) => ({
	type: "delegation.created",
	item: { type: "delegation", target: "client", id, content: [{ type: "input_text", text: "Work" }] },
});

test("older delegation completion does not clear the current mirrored-request destination", async () => {
	const f = fixture();
	await f.voice.start(start);
	try {
		f.receive(work("first"));
		await Bun.sleep(0);
		f.receive(work("second"));
		await Bun.sleep(0);
		f.finishAt(0, "Older result");
		await Bun.sleep(0);
		f.voice.mirrorText("Current question");
		expect(f.sent.at(-1).delegation_item_id).toBe("second");
		f.finishAt(1, "Newer result");
		await Bun.sleep(0);
		f.voice.mirrorText("Later terminal result");
		expect(f.sent.at(-1).type).toBe("session.context.append");
	} finally {
		await f.voice.stop();
	}
});

test("completed work releases its mirror destination before a slow result write", async () => {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const f = fixture(async record => {
		if (record.kind === "delegationResult") {
			entered.resolve();
			await release.promise;
		}
	});
	await f.voice.start(start);
	try {
		f.receive(work("completed"));
		await Bun.sleep(0);
		f.finish("Done");
		await entered.promise;
		f.voice.mirrorText("Independent terminal result");
		expect(f.sent.at(-1)).toEqual({
			type: "session.context.append",
			content: [{ type: "input_text", text: "Independent terminal result" }],
		});
	} finally {
		release.resolve();
		await Bun.sleep(0);
		await f.voice.stop();
	}
});
