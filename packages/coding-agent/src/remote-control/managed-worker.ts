import { lstat, unlink } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { connectPeer, type LocalPeer, listenLocal } from "./ipc";
import {
	createManagedSessionRuntime,
	type ManagedRuntime,
	type ManagedSessionRuntimeRequest,
} from "./managed-sessions";
import { type Notification, ProtocolError } from "./session";

interface QueuedWorkerEvent {
	seq: number;
	event: Notification;
}

export interface ManagedSessionWorkerOptions {
	createRuntime?: (request: ManagedSessionRuntimeRequest) => Promise<ManagedRuntime>;
}

async function prepareSocket(socketPath: string): Promise<void> {
	if (!isAbsolute(socketPath) || normalize(socketPath) !== socketPath)
		throw new Error("Managed worker socket must be normalized and absolute");
	let active = false;
	try {
		const peer = await connectPeer(socketPath);
		peer.close();
		active = true;
	} catch (error) {
		if (!["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
	}
	if (active) throw new Error("Managed worker socket is already active");
	try {
		const entry = await lstat(socketPath);
		if (!entry.isSocket() || entry.uid !== process.getuid?.())
			throw new Error("Refusing to replace a non-owned managed worker socket");
		await unlink(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function endpointView(runtime: ManagedRuntime): Record<string, unknown> {
	return {
		thread: runtime.endpoint.thread,
		models: runtime.endpoint.models ?? [],
		skills: runtime.endpoint.skills ?? [],
		skillErrors: runtime.endpoint.skillErrors ?? [],
		collaborationMode: runtime.endpoint.collaborationMode ?? "default",
		requests: runtime.endpoint.requests ?? [],
	};
}

function workerDescription(runtime: ManagedRuntime, events: QueuedWorkerEvent[]): Record<string, unknown> {
	return { endpoint: endpointView(runtime), events: [...events], pid: process.pid };
}

/**
 * Owns one phone-created AgentSession independently from the relay host.
 * A replacement host can reconnect to this owner without restarting work.
 */
export async function startManagedSessionWorker(
	socketPath: string,
	options: ManagedSessionWorkerOptions = {},
): Promise<{ close: () => Promise<void>; finished: Promise<void> }> {
	await prepareSocket(socketPath);
	const createRuntime = options.createRuntime ?? createManagedSessionRuntime;
	const peers = new Set<LocalPeer>();
	let attached: LocalPeer | undefined;
	let runtime: ManagedRuntime | undefined;
	let runtimeClosing: Promise<void> | undefined;
	let closing: Promise<void> | undefined;
	let nextSequence = 1;
	const events: QueuedWorkerEvent[] = [];
	const finished = Promise.withResolvers<void>();

	const acknowledge = (through: number): void => {
		while (events[0] && events[0].seq <= through) events.shift();
	};
	const publish = (event: Notification): void => {
		const queued = { seq: nextSequence++, event };
		events.push(queued);
		if (events.length > 128) events.shift();
		const peer = attached;
		if (!peer) return;
		void peer.call("worker/event", { ...queued, endpoint: runtime ? endpointView(runtime) : undefined }).then(
			result => {
				const ack = (result as { ack?: unknown } | undefined)?.ack;
				if (typeof ack === "number" && Number.isSafeInteger(ack)) acknowledge(ack);
			},
			() => {
				if (attached === peer) attached = undefined;
			},
		);
	};

	const closeRuntime = (): Promise<void> => {
		if (runtimeClosing) return runtimeClosing;
		const current = runtime;
		runtime = undefined;
		runtimeClosing = current?.close(true) ?? Promise.resolve();
		return runtimeClosing;
	};
	const close = (): Promise<void> => {
		if (closing) return closing;
		closing = (async () => {
			attached = undefined;
			await closeRuntime();
			for (const peer of peers) peer.close();
			await new Promise<void>(resolve => server.close(() => resolve()));
			await unlink(socketPath).catch(error => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			});
		})().finally(() => finished.resolve());
		return closing;
	};

	const server = await listenLocal(socketPath, peer => {
		peers.add(peer);
		peer.onClose = () => {
			peers.delete(peer);
			if (attached === peer) attached = undefined;
		};
		peer.handle = async (method, params) => {
			if (method === "worker/initialize") {
				if (runtime) throw new ProtocolError(-32000, "Managed worker is already initialized");
				const request = params.request as ManagedSessionRuntimeRequest | undefined;
				if (
					!request ||
					typeof request !== "object" ||
					!["start", "resume", "fork"].includes(String(request.kind)) ||
					!request.params ||
					typeof request.params !== "object"
				)
					throw new ProtocolError(-32602, "Invalid managed worker initialization");
				runtime = await createRuntime(request);
				runtime.setPublisher?.(publish);
				attached?.close();
				attached = peer;
				return workerDescription(runtime, events);
			}
			if (method === "worker/describe") {
				if (!runtime) throw new ProtocolError(-32000, "Managed worker is not initialized");
				attached?.close();
				attached = peer;
				return workerDescription(runtime, events);
			}
			if (method === "worker/sessionCall") {
				if (
					!runtime ||
					typeof params.identity !== "string" ||
					typeof params.method !== "string" ||
					!params.params ||
					typeof params.params !== "object" ||
					Array.isArray(params.params)
				)
					throw new ProtocolError(-32602, "Invalid managed session request");
				const result = await runtime.endpoint.call(
					params.identity,
					params.method,
					params.params as Record<string, unknown>,
				);
				return { result, endpoint: endpointView(runtime) };
			}
			if (method === "worker/ack") {
				if (typeof params.seq !== "number" || !Number.isSafeInteger(params.seq))
					throw new ProtocolError(-32602, "Invalid managed worker acknowledgement");
				acknowledge(params.seq);
				return {};
			}
			if (method === "worker/stop") {
				await closeRuntime();
				setTimeout(() => void close(), 0);
				return {};
			}
			throw new ProtocolError(-32601, "Unsupported managed worker method");
		};
	});
	return { close, finished: finished.promise };
}
