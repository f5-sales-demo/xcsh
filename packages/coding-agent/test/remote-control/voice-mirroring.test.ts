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
	let outputUpdate: ((update: any) => void) | undefined;
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "fixture", accountId: "123456789012" }),
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			queueMicrotask(() =>
				handlers.message(JSON.stringify({ type: "session.created", session: { id: "fixture-session" } })),
			);
			return {
				send: data => {
					if (!(JSON.parse(data).type === "session.instructions.append")) sent.push(JSON.parse(data));
					if (JSON.parse(data).type === "session.instructions.append")
						queueMicrotask(() =>
							handlers.message(
								JSON.stringify({
									type: "session.instructions.appended",
									client_event_id: JSON.parse(data).event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
					if (JSON.parse(data).type === "session.context.append")
						queueMicrotask(() =>
							handlers.message(
								JSON.stringify({
									type: "session.context.appended",

									start_ms: performance.now(),
									end_ms: performance.now() + 1,
								}),
							),
						);
				},
				close() {},
				bufferedAmount: 0,
			};
		},
		emit() {},
		records: () => [],
		record,
		delegate: async (_key, _prompt, update) => {
			outputUpdate = update;
			return new Promise<string>(resolve => {
				finish = resolve;
				finishes.push(resolve);
			});
		},
	});
	return {
		voice,
		start: async (params: Record<string, unknown>) => {
			await voice.start(params);
			voice.appendText("Read the requested result");
			await Bun.sleep(0);
			sent.length = 0;
		},
		get sent() {
			return sent.filter(
				frame => !(frame.type === "session.context.append" && frame.content?.[0]?.text?.startsWith("You are xcsh")),
			);
		},
		receive: (event: unknown) => receive(JSON.stringify(event)),
		finish: (text: string) => finish(text),
		finishAt: (index: number, text: string) => finishes[index](text),
		outputUpdate: (update: any) => outputUpdate?.(update),
	};
}

test("Live mirrors completed standalone text and respects response-item routing", async () => {
	for (const asItems of [false, true]) {
		const f = fixture();
		await f.start({
			...start,
			codexResponseHandoffMode: "bemTags",
			codexResponsesAsItems: asItems,
			codexResponseItemPrefix: "PREFIX",
		});
		try {
			f.voice.mirrorText("[FINAL]Terminal result", "commentary");
			const text = asItems ? "PREFIX\n\n[FINAL]Terminal result" : "[FINAL]Terminal result";
			expect(f.sent).toEqual([
				{ type: "session.context.append", channel: "speakable", content: [{ type: "input_text", text }] },
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
	await f.start({ ...start, codexResponseHandoffMode: "bemTags" });
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
	await f.start({ ...start, clientManagedHandoffs: true });
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
	await f.start({ ...start, codexResponseHandoffMode: "bemTags" });
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
		expect(f.sent.length).toBeGreaterThanOrEqual(1);
		expect(f.sent.every(frame => Buffer.byteLength(frame.content[0].text) <= 500)).toBe(true);
		expect(
			f.sent
				.map(frame => frame.content[0].text)
				.join("")
				.split("\n\n")
				.slice(0, 2)
				.join("\n\n"),
		).toBe(
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
		expect(f.sent.length).toBeGreaterThanOrEqual(1);
		expect(f.sent.every(frame => Buffer.byteLength(frame.content[0].text) <= 500)).toBe(true);
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
		const { completedVoiceText } = await import("../../src/remote-control/voice-output");
		const f = fixture();
		await f.start({
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
			listener({ type: "message_start", message: { role: "user", content: "begin", timestamp: 0 } });
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
			const mirroredRequest = JSON.parse(mirrored[0].split("\n\n")[1]);
			if (kind === undefined)
				expect(mirroredRequest).toMatchObject({
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
			else
				expect(mirroredRequest).toMatchObject({
					type: kind === "command" ? "command_execution_approval" : "file_change_approval",
					call_id: "ask",
				});
			expect(remote.pendingRequests()).toHaveLength(1);
			const id = broker.pending()[0].id;
			await remote.call("answer", "session/interaction/respond", {
				threadId: "fixture",
				requestId: id,
				response: kind === undefined ? { answers: { [id]: { answers: ["Alpha"] } } } : { decision: "accept" },
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
	await f.start(start);
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
	await f.start(start);
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

test("remote session refreshes verified task and workspace facts after backend changes", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const { SessionManager } = await import("../../src/session/session-manager");
	const { UserInteractions } = await import("../../src/session/user-interactions");
	const broker = new UserInteractions();
	const manager = SessionManager.inMemory();
	let listener = (_event: any) => {};
	let cwd = "/tmp/first";
	const snapshots: any[] = [];
	const begin = spyOn(NativeVoice.prototype, "start").mockResolvedValue();
	const end = spyOn(NativeVoice.prototype, "stop").mockResolvedValue();
	const refresh = spyOn(NativeVoice.prototype, "refreshContext").mockImplementation(async function (this: any) {
		snapshots.push(await this.deps.persona());
	});
	const target: any = {
		sessionId: manager.getSessionId(),
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		thinkingLevel: "high",
		messages: [],
		sessionManager: manager,
		userInteractions: broker,
		subscribe: (fn: typeof listener) => {
			listener = fn;
			return () => {};
		},
	};
	manager.getCwd = () => cwd;
	const remote = new RemoteSession(target);
	try {
		await remote.call("voice", "thread/realtime/start", { ...start, threadId: target.sessionId });
		cwd = "/tmp/second";
		listener({
			type: "tool_execution_end",
			toolCallId: "read-fixture",
			toolName: "read",
			isError: false,
			result: { content: [] },
		});
		await Bun.sleep(0);
		expect(snapshots.at(-1).runtime).toMatchObject({
			workspace: "/tmp/second",
			model: "gpt-6-astra",
			reasoning: "high",
			taskStatus: "idle",
		});
		const pending = broker.requestInput({
			title: "Synthetic scope",
			inputQuestions: [
				{
					id: "scope",
					header: "Scope",
					question: "Which scope?",
					options: [{ label: "Focused", description: "Synthetic" }],
				},
			],
		});
		await Bun.sleep(0);
		expect(snapshots.at(-1).runtime.taskStatus).toBe("waitingOnUserInput");
		const question = broker.pending()[0]!;
		broker.respond(question.id, { answers: { scope: { answers: ["Focused"] } } });
		await pending;
		await Bun.sleep(0);
		expect(snapshots.at(-1).runtime.taskStatus).toBe("idle");
	} finally {
		broker.cancelAll();
		await remote.close();
		begin.mockRestore();
		end.mockRestore();
		refresh.mockRestore();
	}
});

test("completed list handoff preserves exact identifiers and records captured speech omission", async () => {
	const records: Record<string, unknown>[] = [];
	const f = fixture(async record => {
		records.push(record);
	});
	await f.start({ ...start, codexResponsesAsItems: true, codexResponseHandoffMode: "bemTags" });
	try {
		f.receive({ type: "input_transcript.added", item: { text: "What files are in this project?" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "list-task",
				content: [{ type: "input_text", text: "What files are in this project?" }],
			},
		});
		await Bun.sleep(0);
		f.finish("This project contains:\n- `arithmetic.test.ts`\n- `package.json`\n- `README.md`");
		await Bun.sleep(0);
		const sent = f.sent.find(frame => frame.type === "session.context.append" && frame.channel === "speakable");
		expect(sent.content[0].text).toContain('Exact identifiers: ["arithmetic.test.ts","package.json","README.md"]');
		f.receive({
			type: "turn.done",
			turn: { role: "assistant", id: "short-answer", transcript: "I see arithmetic test, package, and readme." },
		});
		await Bun.sleep(0);
		expect(records.some(record => record.kind === "voiceResultFidelity")).toBe(false);
		await f.voice.stop();
		const observation = records.find(record => record.kind === "voiceResultFidelity");
		expect(observation?.outcome).toBe("omitted");
		expect(observation?.missingCount).toBe(3);
		expect(observation?.delegationIdSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(observation)).not.toContain("README.md");
		expect(records.filter(record => record.kind === "delegation" && record.state === "submitted")).toHaveLength(1);
		expect(f.voice.active).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test.each([false, true])("both completed handoff paths observe exact names without replay, items=%s", async asItems => {
	const records: Record<string, unknown>[] = [];
	const f = fixture(async record => {
		records.push(record);
	});
	await f.start({ ...start, codexResponsesAsItems: asItems, codexResponseHandoffMode: "bemTags" });
	try {
		f.receive({ type: "input_transcript.added", item: { text: "List files" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "list",
				content: [{ type: "input_text", text: "List files" }],
			},
		});
		await Bun.sleep(0);
		f.finish("- `first.ts`\n- `second.ts`");
		await Bun.sleep(0);
		const sent = f.sent.find(frame => frame.channel === "speakable");
		expect(sent.content[0].text).toContain('Exact identifiers: ["first.ts","second.ts"]');
		f.receive({
			type: "turn.done",
			turn: { role: "assistant", id: "answer", transcript: "first dot ts and second dot ts" },
		});
		await Bun.sleep(0);
		expect(records.find(record => record.kind === "voiceResultFidelity")?.outcome).toBe("matched");
		expect(records.filter(record => record.kind === "delegation" && record.state === "submitted")).toHaveLength(1);
	} finally {
		await f.voice.stop();
	}
});

test.each([false, true])(
	"runtime retains the list across multiple assistant segment finals, items=%s",
	async asItems => {
		const records: Record<string, unknown>[] = [];
		const f = fixture(async record => {
			records.push(record);
		});
		await f.start({ ...start, codexResponsesAsItems: asItems, codexResponseHandoffMode: "bemTags" });
		try {
			f.receive({ type: "input_transcript.added", item: { text: "List project files" } });
			f.receive({
				type: "delegation.created",
				item: {
					type: "delegation",
					target: "client",
					id: "segmented-list",
					content: [{ type: "input_text", text: "List project files" }],
				},
			});
			await Bun.sleep(0);
			f.finish("- `first.ts`\n- `middle.ts`\n- `last.ts`");
			await Bun.sleep(0);
			f.receive({ type: "turn.done", turn: { role: "assistant", id: "first", transcript: "first dot ts," } });
			f.receive({ type: "turn.done", turn: { role: "assistant", id: "middle", transcript: "middle dot ts," } });
			await Bun.sleep(0);
			expect(records.filter(r => r.kind === "voiceResultFidelity")).toHaveLength(0);
			f.receive({ type: "turn.done", turn: { role: "assistant", id: "last", transcript: "last dot ts." } });
			await Bun.sleep(0);
			expect(records.filter(r => r.kind === "voiceResultFidelity")).toMatchObject([
				{ outcome: "matched", expectedCount: 3, missingCount: 0 },
			]);
			expect(records.filter(r => r.kind === "delegation" && r.state === "submitted")).toHaveLength(1);
		} finally {
			await f.voice.stop();
		}
	},
);

// Sanitized replay of the recurring brand pronunciation failure after a backend result.
test("compiled pronunciation cue accompanies product mentions in both backend handoff paths", async () => {
	for (const asItems of [false, true]) {
		const f = fixture();
		await f.start({ ...start, codexResponsesAsItems: asItems, codexResponseHandoffMode: "bemTags" });
		try {
			f.receive({ type: "input_transcript.added", item: { text: "Read the update file" } });
			f.receive({
				type: "delegation.created",
				item: {
					type: "delegation",
					target: "client",
					id: "brand-result",
					content: [{ type: "input_text", text: "Read the update file" }],
				},
			});
			await Bun.sleep(0);
			f.finish(
				"The description is Updated by xcsh voice qualification. Identifier: `xcsh-demo-lb`. No new resource was created.",
			);
			await Bun.sleep(5);
			const text = f.sent
				.filter(frame => ["delegation.context.append", "session.context.append"].includes(frame.type))
				.flatMap(frame => frame.content.map((p: any) => p.text))
				.join("");
			expect(text).toContain('Product pronunciation: xcsh is "ek-see-shell"');
			expect(text).toContain("Updated by ek-see-shell voice qualification");
			expect(text).toContain("`xcsh-demo-lb`");
			expect(
				f.sent
					.filter(frame => frame.content)
					.every(frame => frame.content.every((p: any) => Buffer.byteLength(p.text) <= 500)),
			).toBe(true);
		} finally {
			await f.voice.stop();
		}
	}
});

test("captured uppercase product in capability speech projects phonetically while history stays original", async () => {
	for (const asItems of [false, true]) {
		const records: Record<string, unknown>[] = [];
		const f = fixture(async row => {
			records.push(row);
		});
		await f.start({ ...start, codexResponsesAsItems: asItems, codexResponseHandoffMode: "bemTags" });
		try {
			f.receive({ type: "input_transcript.added", item: { text: "Tell me about xcsh capabilities" } });
			f.receive({
				type: "delegation.created",
				item: {
					type: "delegation",
					target: "client",
					id: "brand",
					content: [{ type: "input_text", text: "Tell me about xcsh capabilities" }],
				},
			});
			await Bun.sleep(0);
			const result =
				'XCSH 23.3.3 is a technical coworker. Resource `xcsh-demo-lb`; exact value "Updated by xcsh voice qualification".';
			f.finish(result);
			await Bun.sleep(5);
			const text = f.sent
				.filter(frame => frame.content)
				.flatMap(frame => frame.content.map((p: any) => p.text))
				.join("");
			expect(text).toContain("ek-see-shell 23.3.3 is a technical coworker.");
			expect(text).not.toContain("XCSH 23.3.3");
			expect(text).toContain("`xcsh-demo-lb`");
			expect(text).toContain('"Updated by xcsh voice qualification"');
			expect(records).toContainEqual(expect.objectContaining({ kind: "delegationResult", text: result }));
		} finally {
			await f.voice.stop();
		}
	}
});

test("fragmented final output waits for item completion before product speech projection", async () => {
	const f = fixture();
	await f.start({ ...start, codexResponseHandoffMode: "bemTags" });
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Tell me about the product" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "split-brand",
				content: [{ type: "input_text", text: "Tell me about the product" }],
			},
		});
		await Bun.sleep(0);
		f.outputUpdate({ id: "final", text: "[FINAL]XC", done: false });
		await Bun.sleep(220);
		expect(f.sent.filter(frame => frame.channel === "speakable")).toHaveLength(0);
		f.outputUpdate({ id: "final", text: '[FINAL]XCSH helps. Exact value "xcsh".', done: true });
		f.finish('[FINAL]XCSH helps. Exact value "xcsh".');
		await Bun.sleep(5);
		const text = f.sent
			.filter(frame => frame.channel === "speakable")
			.flatMap(frame => frame.content.map((p: any) => p.text))
			.join("");
		expect(text).toContain('ek-see-shell helps. Exact value "xcsh".');
		expect(text).not.toContain("[FINAL]XC");
	} finally {
		await f.voice.stop();
	}
});

test("saved Plan card details reach voice with concise readback guidance and bounded frames", async () => {
	const f = fixture();
	await f.start(start);
	try {
		const plan =
			"<proposed_plan>\n# Review\n\nResolve inside address and retained ownership. Deployment is not authorized.\n</proposed_plan>";
		f.voice.mirrorText(plan, "final_answer");
		const output = f.sent.map(frame => frame.content[0].text).join("");
		expect(output).toContain("one or two short sentences");
		expect(output).toContain("Plan card");
		expect(output).toContain(plan);
		expect(f.sent.every(frame => Buffer.byteLength(frame.content[0].text) <= 500)).toBe(true);
	} finally {
		await f.voice.stop();
	}
});
