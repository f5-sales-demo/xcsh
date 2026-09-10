import { afterEach, expect, test, vi } from "bun:test";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import type { ExtensionRunner } from "../../src/extensibility/extensions/runner";
import { RemoteSession } from "../../src/remote-control/session";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
	vi.restoreAllMocks();
});
async function fixture(manager = SessionManager.inMemory("/tmp/lifecycle"), extensionRunner?: ExtensionRunner) {
	const auth = await AuthStorage.create(":memory:");
	cleanup.push(() => auth.close());
	const session = new AgentSession({
		agent: new Agent({ initialState: { messages: [], tools: [] } }),
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
		extensionRunner,
	});
	cleanup.push(() => session.dispose());
	const remote = new RemoteSession(session);
	cleanup.push(() => remote.dispose());
	return { session, manager, remote };
}

test("new terminal sessions scope cached RPCs and reject requests to the departed identity", async () => {
	const { session, remote } = await fixture();
	const oldId = session.sessionId;
	await remote.call("reused-rpc", "thread/realtime/stop", { threadId: oldId });
	await session.newSession();
	expect(session.sessionId).not.toBe(oldId);
	expect(await remote.call("reused-rpc", "thread/realtime/stop", { threadId: session.sessionId })).toEqual({});
	await expect(remote.call("old-retry", "thread/read", { threadId: oldId })).rejects.toMatchObject({ code: -32602 });
	expect(remote.thread().id).toBe(session.sessionId);
});

test("session transitions cancel pending input before changing storage", async () => {
	const { session } = await fixture();
	const oldId = session.sessionId;
	const resolved: string[] = [];
	session.userInteractions.subscribe(event => {
		if (event.type === "resolved") resolved.push(session.sessionId);
	});
	const answer = session.userInteractions.request(
		{ kind: "input", title: "Fixture question" },
		() => new Promise(() => {}),
	);
	await session.newSession();
	expect(await answer).toBeUndefined();
	expect(resolved).toEqual([oldId]);
	expect(session.userInteractions.pending()).toEqual([]);
	const last = session.userInteractions.request(
		{ kind: "input", title: "Fixture shutdown" },
		() => new Promise(() => {}),
	);
	await session.dispose();
	expect(await last).toBeUndefined();
	expect(session.userInteractions.pending()).toEqual([]);
});

test("session changes await before listeners while the old storage identity is still current", async () => {
	const { session, manager, remote } = await fixture();
	const oldId = session.sessionId;
	const entered = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const phases: string[] = [];
	(session as any).subscribeSessionTransitions(async (phase: string) => {
		phases.push(phase);
		if (phase === "before") {
			entered.resolve();
			await finish.promise;
			manager.appendCustomEntry("fixture-close", { closed: true });
		}
	});
	const switching = session.newSession();
	await entered.promise;
	expect(session.sessionId).toBe(oldId);
	await expect(remote.call("during-switch", "thread/realtime/stop", { threadId: oldId })).rejects.toMatchObject({
		code: -32000,
	});
	finish.resolve();
	await switching;
	expect(phases).toEqual(["before", "after"]);
	expect(manager.getBranch().some(e => e.type === "custom" && e.customType === "fixture-close")).toBe(false);
});

test("a failed session transition resumes the original adapter without leaking its transition lock", async () => {
	const { session, manager, remote } = await fixture();
	const oldId = session.sessionId;
	const original = manager.newSession;
	manager.newSession = async () => {
		throw new Error("fixture storage failure");
	};
	await expect(session.newSession()).rejects.toThrow("fixture storage failure");
	expect(session.sessionId).toBe(oldId);
	expect(await remote.call("after-failure", "thread/realtime/stop", { threadId: oldId })).toEqual({});
	manager.newSession = original;
	await session.newSession();
	expect(await remote.call("after-failure", "thread/realtime/stop", { threadId: session.sessionId })).toEqual({});
});

test.each(["flush", "newSession"])("failed %s retains the existing agent conversation", async operation => {
	const { session, manager, remote } = await fixture();
	const message = { role: "user" as const, content: "keep this session context", timestamp: 1000 };
	manager.appendMessage(message);
	session.agent.replaceMessages([message]);
	const oldId = session.sessionId;
	manager[operation] = async () => {
		throw new Error("fixture storage failure");
	};
	await expect(session.newSession()).rejects.toThrow("fixture storage failure");
	expect(session.sessionId).toBe(oldId);
	expect(session.messages).toEqual([message]);
	expect(remote.history().flatMap(turn => turn.items)).toMatchObject([
		{ type: "userMessage", content: [{ text: "keep this session context" }] },
	]);
});

test.each(["failed switch", "reload", "return to session"])(
	"%s preserves accepted prompt identities without executing them again",
	async operation => {
		const { mkdtemp, rm } = await import("node:fs/promises");
		const dir = await mkdtemp("/tmp/xcsh-lifecycle-retry-");
		cleanup.push(() => rm(dir, { recursive: true, force: true }));
		const { session, manager, remote } = await fixture(SessionManager.create(dir, dir));
		let prompts = 0;
		session.prompt = async () => {
			prompts++;
		};
		const input = { threadId: session.sessionId, input: [{ type: "text", text: "execute once" }] };
		const accepted = await remote.call("accepted-prompt", "turn/start", input);
		await Bun.sleep(0);
		const file = session.sessionFile!;
		if (operation === "failed switch") {
			manager.newSession = async () => {
				throw new Error("fixture storage failure");
			};
			await expect(session.newSession()).rejects.toThrow("fixture storage failure");
		} else if (operation === "reload") {
			await session.reload();
		} else {
			await session.newSession();
			await session.switchSession(file);
		}
		const retried = await remote.call("accepted-prompt", "turn/start", input);
		expect(prompts).toBe(1);
		expect(retried).toEqual(accepted);
	},
);

test("a remote prompt awaiting persistence cannot execute against the next terminal session", async () => {
	const { session, manager, remote } = await fixture();
	const pending = Promise.withResolvers<void>();
	manager.ensureOnDisk = () => pending.promise;
	let prompts = 0;
	session.prompt = async () => {
		prompts++;
	};
	const start = remote.call("pending-turn", "turn/start", {
		threadId: session.sessionId,
		input: [{ type: "text", text: "old request" }],
	});
	await session.newSession();
	pending.resolve();
	await expect(start).rejects.toMatchObject({ code: -32000 });
	expect(prompts).toBe(0);
	expect(remote.history()).toEqual([]);
});

test("real voice closure and end instructions settle on old storage before switching", async () => {
	const { spyOn } = await import("bun:test");
	const { session, manager, remote } = await fixture();
	const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "example-lifecycle-account" } })).toString("base64url")}.fixture`;
	const auth = session.modelRegistry.authStorage;
	const credential = spyOn(auth, "getCredentialSource").mockReturnValue("stored-oauth");
	const key = spyOn(auth, "getApiKey").mockResolvedValue(token);
	let socket: any;
	class Socket {
		bufferedAmount = 0;
		onopen?: () => void;
		onmessage?: (event: { data: string }) => void;
		constructor() {
			socket = this;
			queueMicrotask(() => this.onopen?.());
		}
		send() {}
		close() {}
	}
	const websocket = spyOn(globalThis as any, "WebSocket").mockImplementation((() => new Socket()) as any);
	const callModule = await import("../../src/remote-control/voice-call");
	const call = spyOn(callModule, "createVoiceCall").mockResolvedValue({
		callId: "fixture-call",
		sdp: "v=0\r\nfixture-answer",
	});
	cleanup.push(() => {
		websocket.mockRestore();
		call.mockRestore();
		key.mockRestore();
		credential.mockRestore();
	});
	const entered = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const writes: { id: string; kind: string }[] = [];
	session.sendCustomMessage = async () => {
		entered.resolve();
		await finish.promise;
		writes.push({ id: session.sessionId, kind: "instructions" });
		manager.appendCustomEntry("fixture-instructions", {});
	};
	const append = manager.appendCustomEntry.bind(manager);
	manager.appendCustomEntry = (kind, data) => {
		if (kind === "remote-realtime")
			writes.push({ id: session.sessionId, kind: (data as any).item?.type ?? (data as any).kind });
		return append(kind, data);
	};
	const oldId = session.sessionId;
	await remote.call("voice-start", "thread/realtime/start", {
		threadId: oldId,
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		realtimeEndInstructions: "fixture close",
	});
	const receive = socket.onmessage;
	const switching = session.newSession();
	await entered.promise;
	await Bun.sleep(0);
	expect(session.sessionId).toBe(oldId);
	finish.resolve();
	await switching;
	expect(writes.some(write => write.kind === "realtimeSessionClosed")).toBe(true);
	expect(writes.every(write => write.id === oldId)).toBe(true);
	receive({ data: JSON.stringify({ type: "output_transcript.added", item: { text: "late" } }) });
	await Bun.sleep(0);
	expect(
		manager
			.getBranch()
			.some(
				entry => entry.type === "custom" && ["remote-realtime", "fixture-instructions"].includes(entry.customType),
			),
	).toBe(false);
	await remote.call("new-voice", "thread/realtime/start", {
		threadId: session.sessionId,
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	});
	remote.dispose();
	await Bun.sleep(0);
	expect(writes.some(write => write.id === session.sessionId && write.kind === "realtimeSessionClosed")).toBe(true);
});

test("the bridge replaces its registered identity before a terminal switch returns", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { startLocalHost } = await import("../../src/remote-control/host");
	const { startSessionBridge } = await import("../../src/remote-control/bridge");
	const { session, remote } = await fixture();
	remote.dispose();
	const dir = await mkdtemp("/tmp/xcsh-lifecycle-");
	const host = await startLocalHost(`${dir}/host.sock`, "fixture");
	const stop = startSessionBridge(session, `${dir}/host.sock`, 60_000);
	cleanup.push(async () => {
		stop();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	});
	const oldId = session.sessionId;
	const deadline = Date.now() + 1000;
	while (!host.router.sessions.has(oldId) && Date.now() < deadline) await Bun.sleep(5);
	expect(host.router.sessions.has(oldId)).toBe(true);
	await session.newSession();
	expect(host.router.sessions.has(oldId)).toBe(false);
	expect(host.router.sessions.has(session.sessionId)).toBe(true);
	expect(host.router.sessions.size).toBe(1);
});

test("all transition listeners recover even when an earlier after listener fails", async () => {
	const { session } = await fixture();
	const unsubscribe = session.subscribeSessionTransitions(phase => {
		if (phase === "after") throw new Error("fixture listener failure");
	});
	let restored = 0;
	session.subscribeSessionTransitions(phase => {
		if (phase === "after") restored++;
	});
	await expect(session.newSession()).rejects.toThrow("fixture listener failure");
	expect(restored).toBe(1);
	unsubscribe();
	await session.newSession();
	expect(restored).toBe(2);
});

test("overlapping terminal transitions cannot interleave storage changes", async () => {
	const { session } = await fixture();
	const entered = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	session.subscribeSessionTransitions(async phase => {
		if (phase === "before") {
			entered.resolve();
			await finish.promise;
		}
	});
	const oldId = session.sessionId;
	const first = session.newSession();
	await entered.promise;
	await expect(session.newSession()).rejects.toThrow("already in progress");
	expect(session.sessionId).toBe(oldId);
	finish.resolve();
	await first;
	expect(session.sessionId).not.toBe(oldId);
});

test("fork, resume, reload and branch refresh the adapter against persisted owner history", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const dir = await mkdtemp("/tmp/xcsh-lifecycle-files-");
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const { session, manager, remote } = await fixture(SessionManager.create(dir, dir));
	manager.appendMessage({ role: "user", content: "first context", timestamp: 1000 });
	const second = manager.appendMessage({ role: "user", content: "second context", timestamp: 2000 });
	await manager.ensureOnDisk();
	await manager.flush();
	const originalId = session.sessionId;
	const originalFile = session.sessionFile!;
	const stop = () => remote.call("lifecycle-rpc", "thread/realtime/stop", { threadId: session.sessionId });
	await stop();
	expect(await session.fork()).toBe(true);
	expect(session.sessionId).not.toBe(originalId);
	expect(await stop()).toEqual({});
	expect(remote.history().flatMap(t => t.items)).toHaveLength(2);
	await session.switchSession(originalFile);
	expect(session.sessionId).toBe(originalId);
	expect(await stop()).toEqual({});
	await session.reload();
	await expect(remote.call("lifecycle-rpc", "unsupported", { threadId: session.sessionId })).rejects.toMatchObject({
		code: -32600,
	});
	await session.branch(second);
	expect(session.sessionId).not.toBe(originalId);
	expect(await stop()).toEqual({});
	expect(remote.history().flatMap(t => t.items)).toMatchObject([
		{ type: "userMessage", content: [{ text: "first context" }] },
	]);
	expect(remote.thread().createdAt).toBe(Math.floor(Date.parse(manager.getHeader()!.timestamp) / 1000));
});

test("failed new-session storage leaves owner event persistence connected", async () => {
	const { getBundledModel } = await import("@f5-sales-demo/pi-ai");
	const { AssistantMessageEventStream } = await import("@f5-sales-demo/pi-ai/utils/event-stream");
	const { session, manager } = await fixture();
	manager.newSession = async () => {
		throw new Error("fixture storage failure");
	};
	await expect(session.newSession()).rejects.toThrow("fixture storage failure");
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	session.agent.setModel(model);
	session.agent.streamFn = () => {
		const stream = new AssistantMessageEventStream();
		queueMicrotask(() =>
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "owner connected" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					stopReason: "stop",
					timestamp: Date.now(),
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				},
			}),
		);
		return stream;
	};
	await session.agent.prompt("after failed switch");
	expect(manager.getBranch().some(entry => entry.type === "message" && entry.message.role === "user")).toBe(true);
});

test.each(["steer", "interrupt"])(
	"accepted %s settles against the old owner before its storage changes",
	async method => {
		const { session, manager, remote } = await fixture();
		const prompt = Promise.withResolvers<void>();
		const steering = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		session.prompt = () => prompt.promise;
		const accept = async () => {
			entered.resolve();
			await steering.promise;
			manager.appendMessage({ role: "user", content: "old steering", timestamp: 1000 });
		};
		if (method === "steer") session.steer = accept;
		else session.abort = accept;
		const oldId = session.sessionId;
		const started = (await remote.call("work", "turn/start", {
			threadId: oldId,
			input: [{ type: "text", text: "work" }],
		})) as { turn: { id: string } };
		const steer = remote.call("control", `turn/${method}`, {
			threadId: oldId,
			...(method === "steer" ? { expectedTurnId: started.turn.id } : { turnId: started.turn.id }),
			input: [{ type: "text", text: "old steering" }],
		});
		await entered.promise;
		const switching = session.newSession();
		await Bun.sleep(0);
		const stayedWithOldOwner = session.sessionId === oldId;
		steering.resolve();
		await steer;
		await switching;
		prompt.resolve();
		expect(stayedWithOldOwner).toBe(true);
		expect(remote.history()).toEqual([]);
	},
);

test.each(["new", "fork", "resume", "branch", "tree"])(
	"a delayed %s extension hook cannot replace a newer session",
	async operation => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let hold = true;
		const extensionRunner = {
			hasHandlers: (name: string) =>
				["session_before_switch", "session_before_branch", "session_before_tree"].includes(name),
			emit: async (event: { type: string }) => {
				if (hold && event.type.startsWith("session_before_")) {
					hold = false;
					entered.resolve();
					await release.promise;
				}
			},
		} as unknown as ExtensionRunner;
		const { mkdtemp, readdir, rm } = await import("node:fs/promises");
		const dir = await mkdtemp("/tmp/xcsh-delayed-lifecycle-");
		cleanup.push(() => rm(dir, { recursive: true, force: true }));
		const { session, manager, remote } = await fixture(SessionManager.create(dir, dir), extensionRunner);
		const entryId = manager.appendMessage({ role: "user", content: "Original context", timestamp: 1000 });
		manager.appendMessage({ role: "user", content: "Later context", timestamp: 2000 });
		await manager.ensureOnDisk();
		await manager.flush();
		const oldId = session.sessionId;
		const originalFile = session.sessionFile!;
		const pending = (
			operation === "new"
				? session.newSession()
				: operation === "fork"
					? session.fork()
					: operation === "resume"
						? session.switchSession(originalFile)
						: operation === "branch"
							? session.branch(entryId)
							: session.navigateTree(entryId)
		).then(
			value => ({ value }),
			error => ({ error }),
		);
		let nextId: string | undefined;
		try {
			await entered.promise;
			await session.prepareSessionChange(create => create());
			nextId = session.sessionId;
			manager.appendMessage({ role: "user", content: "Replacement context", timestamp: 3000 });
		} finally {
			release.resolve();
		}
		const result = await pending;
		expect(result).toMatchObject({
			error: expect.objectContaining({ message: expect.stringContaining("transition") }),
		});
		expect(nextId).not.toBe(oldId);
		expect(session.sessionId).toBe(nextId);
		expect(manager.getBranch().filter(entry => entry.type === "message")).toHaveLength(1);
		expect(remote.thread().id).toBe(nextId);
		await manager.ensureOnDisk();
		await manager.flush();
		const saved = await SessionManager.open(session.sessionFile!);
		cleanup.push(() => saved.close());
		const original = await SessionManager.open(originalFile);
		cleanup.push(() => original.close());
		expect(saved.getSessionId()).toBe(nextId);
		expect(
			saved
				.getBranch()
				.filter(entry => entry.type === "message")
				.map(entry => entry.message),
		).toMatchObject([{ role: "user", content: "Replacement context" }]);
		expect(
			original
				.getBranch()
				.filter(entry => entry.type === "message")
				.map(entry => entry.message),
		).toMatchObject([{ content: "Original context" }, { content: "Later context" }]);
		expect((await readdir(dir)).filter(name => name.endsWith(".jsonl"))).toHaveLength(2);
		expect(remote.history().flatMap(turn => turn.items)).toMatchObject([
			{ type: "userMessage", content: [{ text: "Replacement context" }] },
		]);
	},
);

test("disposal rejects new input immediately and drains owned preparation before closing storage", async () => {
	const { session, manager, remote } = await fixture();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const closed: string[] = [];
	const close = manager.close.bind(manager);
	vi.spyOn(manager, "close").mockImplementation(async () => {
		closed.push(session.sessionId);
		await close();
	});
	const oldId = session.sessionId;
	const preparation = session
		.prepareSessionChange(async create => {
			entered.resolve();
			await release.promise;
			return create();
		})
		.then(
			value => ({ value }),
			error => ({ error }),
		);
	await entered.promise;
	const disposing = session.dispose();
	try {
		await Bun.sleep(20);
		expect(closed).toEqual([]);
		await expect(session.newSession()).rejects.toThrow("clos");
		await expect(session.steer("Late instruction")).rejects.toThrow("clos");
		await expect(
			remote.call("late-close", "turn/start", {
				threadId: oldId,
				input: [{ type: "text", text: "Late instruction" }],
			}),
		).rejects.toThrow();
	} finally {
		release.resolve();
	}
	const result = await preparation;
	await disposing;
	expect(result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("clos") }) });
	expect(closed).toEqual([oldId]);
	expect(session.sessionId).toBe(oldId);
	await expect(session.prompt("After close")).rejects.toThrow("clos");
});
