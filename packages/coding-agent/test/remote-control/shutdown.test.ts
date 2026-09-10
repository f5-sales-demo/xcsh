import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { startSessionBridge } from "../../src/remote-control/bridge";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";
import { RemoteSession } from "../../src/remote-control/session";
import * as calls from "../../src/remote-control/voice-call";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test.each(["direct", "bridge"])(
	"disposing the terminal drains voice history before closing storage: %s",
	async mode => {
		const bridged = mode === "bridge";
		const dir = await mkdtemp("/tmp/xcsh-voice-shutdown-");
		const auth = await AuthStorage.create(":memory:");
		const manager = SessionManager.create(dir, dir);
		const session = new AgentSession({
			agent: new Agent({ initialState: { messages: [], tools: [] } }),
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
		});
		const remote = bridged ? undefined : new RemoteSession(session);
		const host = bridged ? await startLocalHost(`${dir}/host.sock`, "fixture") : undefined;
		const stop = bridged ? startSessionBridge(session, `${dir}/host.sock`, 60_000) : undefined;
		const phone = bridged ? await connectPeer(`${dir}/host.sock`) : undefined;
		const gate = Promise.withResolvers<void>();
		const records: { kind: string; closed: boolean }[] = [];
		let storageClosed = false;
		let socketsClosed = 0;
		const closeStorage = manager.close.bind(manager);
		manager.close = async () => {
			storageClosed = true;
			await closeStorage();
		};
		const append = manager.appendCustomEntry.bind(manager);
		manager.appendCustomEntry = (kind, data) => {
			records.push({ kind: (data as any)?.item?.type ?? kind, closed: storageClosed });
			return append(kind, data);
		};
		const modes: boolean[] = [];
		const setMode = session.setRealtimeMode.bind(session);
		session.setRealtimeMode = (active, instructions) => {
			modes.push(active);
			expect(storageClosed).toBe(false);
			setMode(active, instructions);
		};
		const flush = manager.flush.bind(manager);
		manager.flush = async () => {
			if (records.some(record => record.kind === "realtimeSessionClosed")) await gate.promise;
			await flush();
		};
		const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "example-shutdown-account" } })).toString("base64url")}.fixture`;
		const credential = spyOn(auth, "getCredentialSource").mockReturnValue("stored-oauth");
		const key = spyOn(auth, "getApiKey").mockResolvedValue(token);
		class Socket {
			bufferedAmount = 0;
			onopen?: () => void;
			constructor() {
				queueMicrotask(() => this.onopen?.());
			}
			send() {}
			close() {
				socketsClosed++;
			}
		}
		const websocket = spyOn(globalThis as any, "WebSocket").mockImplementation((() => new Socket()) as any);
		const call = spyOn(calls, "createVoiceCall").mockResolvedValue({ callId: "fixture-call", sdp: "v=0\r\nfixture" });
		const notifications: string[] = [];
		remote?.subscribe(event => notifications.push(event.method));
		if (phone)
			phone.handle = async (_method, params) => {
				notifications.push((params.event as any).method);
				return {};
			};
		try {
			await manager.ensureOnDisk();
			if (phone && host) {
				const deadline = Date.now() + 1000;
				while (!host.router.sessions.has(session.sessionId) && Date.now() < deadline) await Bun.sleep(5);
				expect(host.router.sessions.has(session.sessionId)).toBe(true);
				await phone.call("protocol", {
					request: { id: 1, method: "initialize", params: { clientInfo: { name: "fixture", version: "1" } } },
				});
			}
			const params = {
				threadId: session.sessionId,
				version: "v3",
				outputModality: "audio",
				includeStartupContext: false,
				transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
				realtimeEndInstructions: "fixture end",
			};
			if (remote) await remote.call("start", "thread/realtime/start", params);
			else
				expect(
					await phone!.call("protocol", { request: { id: 2, method: "thread/realtime/start", params } }),
				).toMatchObject({ result: {} });
			let done = false;
			const disposing = session.dispose().then(() => {
				done = true;
			});
			await Bun.sleep(20);
			expect(socketsClosed).toBe(1);
			expect(storageClosed).toBe(false);
			expect(done).toBe(false);
			gate.resolve();
			await disposing;
			if (host) expect(host.router.sessions.has(session.sessionId)).toBe(false);
			const delivered = Date.now() + 1000;
			while (!notifications.includes("thread/realtime/closed") && Date.now() < delivered) await Bun.sleep(5);
			expect(storageClosed).toBe(true);
			expect(modes).toEqual([true, false]);
			expect(records.some(record => record.kind === "realtimeSessionClosed")).toBe(true);
			expect(records.every(record => !record.closed)).toBe(true);
			expect(notifications.filter(method => method === "thread/realtime/closed")).toHaveLength(1);
			const reopened = await SessionManager.open(session.sessionFile!);
			try {
				expect(
					reopened
						.getBranch()
						.some(entry => entry.type === "custom_message" && entry.customType.startsWith("remote-voice-")),
				).toBe(false);
				expect(
					reopened
						.getBranch()
						.some(
							entry => entry.type === "custom" && (entry.data as any)?.item?.type === "realtimeSessionClosed",
						),
				).toBe(true);
			} finally {
				await reopened.close();
			}
		} finally {
			gate.resolve();
			await remote?.close();
			await stop?.();
			phone?.close();
			await host?.close();
			await session.dispose();
			websocket.mockRestore();
			call.mockRestore();
			key.mockRestore();
			credential.mockRestore();
			auth.close();
			await rm(dir, { recursive: true, force: true });
		}
	},
);

test("terminal disposal unregisters its bridge before disposal completes", async () => {
	const dir = await mkdtemp("/tmp/xcsh-bridge-shutdown-");
	const auth = await AuthStorage.create(":memory:");
	const session = new AgentSession({
		agent: new Agent({ initialState: { messages: [], tools: [] } }),
		sessionManager: SessionManager.inMemory(dir),
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
	});
	const host = await startLocalHost(`${dir}/host.sock`, "fixture");
	const stop = startSessionBridge(session, `${dir}/host.sock`, 60_000);
	try {
		const deadline = Date.now() + 1000;
		while (!host.router.sessions.has(session.sessionId) && Date.now() < deadline) await Bun.sleep(5);
		expect(host.router.sessions.has(session.sessionId)).toBe(true);
		await session.dispose();
		expect(host.router.sessions.has(session.sessionId)).toBe(false);
	} finally {
		await stop();
		await session.dispose();
		await host.close();
		auth.close();
		await rm(dir, { recursive: true, force: true });
	}
});
