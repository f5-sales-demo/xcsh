import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectPeer } from "../../src/remote-control/ipc";
import type { ManagedSessionRuntimeRequest } from "../../src/remote-control/managed-sessions";
import { startManagedSessionWorker } from "../../src/remote-control/managed-worker";
import { RemoteRouter } from "../../src/remote-control/router";
import { replayVoiceFirstSequence } from "../../src/remote-control/voice-first-replay";

test("a managed worker keeps one active turn across host replacement and replays its completion once", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-worker-"));
	const socket = join(root, "worker.sock");
	let calls = 0;
	let publish: ((event: { method: string; params: Record<string, unknown> }) => void) | undefined;
	let finish = () => {};
	const thread = {
		id: "worker-thread",
		sessionId: "worker-thread",
		cwd: "/tmp",
		path: "/tmp/worker-thread.jsonl",
		model: "gpt-5.6-luna",
		modelProvider: "openai-codex",
		reasoningEffort: "medium",
		status: { type: "idle" },
		turns: [],
	};
	const worker = await startManagedSessionWorker(socket, {
		createRuntime: async (_request: ManagedSessionRuntimeRequest) => ({
			endpoint: {
				thread,
				call: async (_identity, method) => {
					if (method !== "turn/start") return { thread };
					calls++;
					thread.status = { type: "active" };
					publish?.({ method: "turn/started", params: { threadId: thread.id, turn: { id: "turn-1" } } });
					await new Promise<void>(resolve => {
						finish = resolve;
					});
					thread.status = { type: "idle" };
					publish?.({ method: "turn/completed", params: { threadId: thread.id, turn: { id: "turn-1" } } });
					return { turn: { id: "turn-1" } };
				},
			},
			setPublisher: listener => {
				publish = listener;
			},
			close: async () => {},
		}),
	});
	try {
		const first = await connectPeer(socket);
		const firstEvents: unknown[] = [];
		first.handle = async (method, params) => {
			if (method === "worker/event") firstEvents.push(params);
			return {};
		};
		const initialized = (await first.call("worker/initialize", {
			request: { kind: "start", params: { cwd: "/tmp" } },
		})) as any;
		expect(initialized.endpoint.thread.id).toBe(thread.id);
		const active = first.call("worker/sessionCall", {
			identity: "fixture-turn",
			method: "turn/start",
			params: { threadId: thread.id, input: [{ type: "text", text: "fixture" }] },
		});
		for (let attempt = 0; attempt < 100 && calls === 0; attempt++) await Bun.sleep(1);
		expect(calls).toBe(1);
		first.close();
		await expect(active).rejects.toThrow("closed");

		const replacement = await connectPeer(socket);
		const replacementEvents: Array<{ event?: { method?: string } }> = [];
		replacement.handle = async (method, params) => {
			if (method === "worker/event") replacementEvents.push(params);
			return {};
		};
		const described = (await replacement.call("worker/describe", {})) as any;
		expect(described.endpoint.thread).toMatchObject({ id: thread.id, status: { type: "active" } });
		expect(described.events).toMatchObject([{ event: { method: "turn/started" } }]);
		finish();
		for (let attempt = 0; attempt < 100 && replacementEvents.length === 0; attempt++) await Bun.sleep(1);
		expect(replacementEvents).toMatchObject([{ event: { method: "turn/completed" } }]);
		expect(calls).toBe(1);
		replacement.close();
	} finally {
		await worker.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("worker stop acknowledges only after the session runtime is durably closed", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-worker-stop-"));
	const socket = join(root, "worker.sock");
	let runtimeClosed = false;
	const worker = await startManagedSessionWorker(socket, {
		createRuntime: async () => ({
			endpoint: {
				thread: { id: "stop-thread", cwd: root, status: { type: "idle" } },
				call: async () => ({}),
			},
			close: async () => {
				await Bun.sleep(25);
				runtimeClosed = true;
			},
		}),
	});
	try {
		const peer = await connectPeer(socket);
		await peer.call("worker/initialize", { request: { kind: "start", params: { cwd: root } } });
		await peer.call("worker/stop", {});
		expect(runtimeClosed).toBe(true);
		peer.close();
		await worker.finished;
	} finally {
		await worker.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("worker snapshots retain generated titles across later events and host replacement", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-worker-title-"));
	const socket = join(root, "worker.sock");
	let publish: ((event: { method: string; params: Record<string, unknown> }) => void) | undefined;
	const thread = {
		id: "managed-title",
		cwd: root,
		name: null as string | null,
		status: { type: "idle" },
	};
	const worker = await startManagedSessionWorker(socket, {
		createRuntime: async () => ({
			endpoint: { thread, call: async () => ({}) },
			setPublisher: listener => {
				publish = listener;
			},
			close: async () => {},
		}),
	});
	try {
		const first = await connectPeer(socket);
		const snapshots: any[] = [];
		first.handle = async (method, params) => {
			if (method === "worker/event") snapshots.push(params.endpoint);
			return { ack: params.seq };
		};
		await first.call("worker/initialize", { request: { kind: "start", params: { cwd: root } } });
		publish?.({
			method: "thread/name/updated",
			params: { threadId: thread.id, threadName: "Verify ABC-3900" },
		});
		publish?.({
			method: "thread/status/changed",
			params: { threadId: thread.id, status: { type: "active", activeFlags: [] } },
		});
		publish?.({
			method: "thread/settings/updated",
			params: {
				threadId: thread.id,
				threadSettings: {
					model: "gpt-6-astra",
					modelProvider: "openai-codex",
					effort: "high",
					collaborationMode: { mode: "plan" },
				},
			},
		});
		for (let attempt = 0; attempt < 100 && snapshots.length < 3; attempt++) await Bun.sleep(1);
		expect(snapshots).toHaveLength(3);
		expect(snapshots[0].thread.name).toBe("Verify ABC-3900");
		expect(snapshots[1].thread).toMatchObject({
			name: "Verify ABC-3900",
			status: { type: "active", activeFlags: [] },
		});
		expect(snapshots[2]).toMatchObject({
			thread: {
				name: "Verify ABC-3900",
				status: { type: "active", activeFlags: [] },
				model: "gpt-6-astra",
				modelProvider: "openai-codex",
				reasoningEffort: "high",
			},
			collaborationMode: "plan",
		});
		first.close();

		const replacement = await connectPeer(socket);
		const described = (await replacement.call("worker/describe", {})) as any;
		expect(described.endpoint.thread).toMatchObject({
			name: "Verify ABC-3900",
			status: { type: "active", activeFlags: [] },
			model: "gpt-6-astra",
			modelProvider: "openai-codex",
			reasoningEffort: "high",
		});
		expect(described.endpoint.collaborationMode).toBe("plan");
		replacement.close();
	} finally {
		await worker.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("voice-first replay crosses a real managed worker with a deterministic realtime transport", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-worker-voice-"));
	const socket = join(root, "worker.sock");
	const notifications: Record<string, unknown>[] = [];
	let publish: ((event: { method: string; params: Record<string, unknown> }) => void) | undefined;
	const thread = {
		id: "managed-voice",
		sessionId: "managed-voice",
		cwd: root,
		model: "gpt-5.6-luna",
		modelProvider: "openai-codex",
		reasoningEffort: "high",
		source: "vscode",
		status: { type: "idle" },
		turns: [],
	};
	const worker = await startManagedSessionWorker(socket, {
		createRuntime: async () => ({
			endpoint: {
				thread,
				call: async (_identity, method) => {
					if (method === "thread/resume") return { thread, model: thread.model, cwd: thread.cwd };
					if (method === "thread/realtime/start") {
						publish?.({
							method: "thread/realtime/started",
							params: { threadId: thread.id, realtimeSessionId: "fixture-call", version: "v3" },
						});
						publish?.({ method: "thread/realtime/sdp", params: { threadId: thread.id, sdp: "fixture-sdp" } });
					}
					return {};
				},
			},
			setPublisher: listener => {
				publish = listener;
			},
			close: async () => {},
		}),
	});
	let peer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	let router: RemoteRouter | undefined;
	try {
		peer = await connectPeer(socket);
		peer.handle = async (method, params) => {
			if (method === "worker/event") {
				router?.publish(params.event as { method: string; params: Record<string, unknown> });
				return { ack: params.seq };
			}
			return {};
		};
		const lifecycle = {
			defaultCwd: root,
			list: () => [],
			start: async (params: Record<string, unknown>) => {
				const description = (await peer!.call("worker/initialize", {
					request: { kind: "start", params },
				})) as any;
				return {
					...description.endpoint,
					call: async (identity: string, method: string, callParams: Record<string, unknown>) =>
						(
							(await peer!.call("worker/sessionCall", { identity, method, params: callParams })) as {
								result: unknown;
							}
						).result,
				};
			},
			resume: async () => undefined,
			read: async () => ({ thread }),
			fork: async () => {
				throw new Error("not used");
			},
			archive: async () => {},
			unarchive: async () => thread,
			delete: async () => {},
		};
		router = new RemoteRouter(root, "fixture", lifecycle);
		router.notify = (_client, event) => notifications.push({ method: event.method, params: event.params });
		await router.handle("phone", {
			id: 0,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		});
		const event = (direction: "in" | "out", message: Record<string, unknown>) => ({
			layer: "rpc",
			direction,
			message,
		});
		const result = await replayVoiceFirstSequence(
			[
				event("in", { id: 1, method: "thread/start", params: { cwd: root } }),
				event("out", { id: 1, result: { thread: { id: { $ref: "thread" }, source: "vscode" } } }),
				event("out", {
					method: "thread/started",
					params: { thread: { id: { $ref: "thread" }, source: "vscode" } },
				}),
				event("in", {
					id: 2,
					method: "thread/realtime/start",
					params: { threadId: "managed-voice", version: "v3" },
				}),
				event("out", { id: 2, result: {} }),
				event("out", {
					method: "thread/realtime/started",
					params: { threadId: { $ref: "thread" }, realtimeSessionId: { $ref: "call" }, version: "v3" },
				}),
				event("out", {
					method: "thread/realtime/sdp",
					params: { threadId: { $ref: "thread" }, sdp: { $redacted: "sdp", valueType: "string" } },
				}),
			],
			{
				send: request => router!.handle("phone", request) as Promise<Record<string, unknown>>,
				nextNotification: async timeoutMs => {
					const deadline = Date.now() + timeoutMs;
					while (notifications.length === 0 && Date.now() < deadline) await Bun.sleep(1);
					if (notifications.length === 0) throw new Error("Timed out waiting for replay notification");
					return notifications.shift()!;
				},
			},
		);
		expect(result.success).toBe(true);
		expect(result.requests).toEqual(["thread/start", "thread/realtime/start"]);
	} finally {
		router?.dispose();
		peer?.close();
		await worker.close();
		await rm(root, { recursive: true, force: true });
	}
});
