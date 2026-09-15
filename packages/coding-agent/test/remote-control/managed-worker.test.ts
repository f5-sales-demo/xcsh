import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectPeer } from "../../src/remote-control/ipc";
import type { ManagedSessionRuntimeRequest } from "../../src/remote-control/managed-sessions";
import { startManagedSessionWorker } from "../../src/remote-control/managed-worker";

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
