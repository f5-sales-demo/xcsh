import { lstat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import type { Enrollment } from "./enrollment";
import { connectPeer, type LocalPeer, listenLocal } from "./ipc";
import { RelayCodec } from "./relay";
import { RemoteRouter, type SessionEndpoint } from "./router";
import { type Notification, ProtocolError } from "./session";
import { type TraceSink, traceFromEnvironment, traceJson } from "./trace-runtime";

async function prepareSocketPath(socketPath: string): Promise<void> {
	let active = false;
	try {
		const peer = await connectPeer(socketPath);
		peer.close();
		active = true;
	} catch (error) {
		if (!["ECONNREFUSED", "ENOENT"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
	}
	if (active) throw new Error("An xcsh remote host is already running");
	try {
		const entry = await lstat(socketPath);
		if (!entry.isSocket() || entry.uid !== process.getuid?.())
			throw new Error("Refusing to replace a non-owned remote socket");
		await unlink(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function registrationSkills(value: unknown): NonNullable<SessionEndpoint["skills"]> {
	if (value == null) return [];
	if (!Array.isArray(value) || value.length > 512) throw new ProtocolError(-32602, "Invalid skill registration");
	for (const skill of value) {
		if (
			!skill ||
			typeof skill !== "object" ||
			typeof skill.name !== "string" ||
			skill.name.length > 256 ||
			typeof skill.description !== "string" ||
			skill.description.length > 32_768 ||
			typeof skill.path !== "string" ||
			skill.path.length > 4096 ||
			!isAbsolute(skill.path) ||
			normalize(skill.path) !== skill.path ||
			!(["user", "repo", "system", "admin"] as unknown[]).includes(skill.scope) ||
			typeof skill.enabled !== "boolean" ||
			(skill.pluginId !== null && (typeof skill.pluginId !== "string" || skill.pluginId.length > 256))
		)
			throw new ProtocolError(-32602, "Invalid skill registration");
	}
	return value as NonNullable<SessionEndpoint["skills"]>;
}

function registrationSkillErrors(value: unknown): NonNullable<SessionEndpoint["skillErrors"]> {
	if (value == null) return [];
	if (
		!Array.isArray(value) ||
		value.length > 512 ||
		value.some(
			error =>
				!error ||
				typeof error !== "object" ||
				typeof error.path !== "string" ||
				error.path.length > 4096 ||
				typeof error.message !== "string" ||
				error.message.length > 32_768,
		)
	)
		throw new ProtocolError(-32602, "Invalid skill error registration");
	return value as NonNullable<SessionEndpoint["skillErrors"]>;
}

export async function startLocalHost(
	socketPath: string,
	version: string,
	trace: TraceSink | undefined = traceFromEnvironment("host", version),
) {
	await prepareSocketPath(socketPath);
	const router = new RemoteRouter(dirname(socketPath), version);
	const peers = new Set<LocalPeer>();
	const localClients = new Map<string, LocalPeer>();
	let publishClient = (_client: string, _event: Notification) => {};
	router.notify = (client, event) => {
		const peer = localClients.get(client);
		if (peer) void peer.call("protocol/event", { event }).catch(() => peer.close());
		else publishClient(client, event);
	};
	const owners = new Map<LocalPeer, { id: string; lastSeen: number }>();
	let closed = false;
	let relayStatus = "disconnected";
	let stopRelay = () => {};
	const server = await listenLocal(socketPath, peer => {
		peers.add(peer);
		const localClient = `local-${crypto.randomUUID()}`;
		localClients.set(localClient, peer);
		const remove = () => {
			const owner = owners.get(peer);
			if (owner) router.removeSession(owner.id);
			owners.delete(peer);
		};
		peer.onClose = () => {
			router.close(localClient);
			localClients.delete(localClient);
			remove();
			peers.delete(peer);
		};
		peer.handle = async (method, params) => {
			if (method === "protocol") return router.handle(localClient, params.request);
			if (method === "status")
				return {
					enabled: true,
					relay: relayStatus,
					liveSessions: router.sessions.size,
					sessions: [...router.sessions.values()].map(s => ({
						id: s.thread.id,
						name: s.thread.name,
						model: s.thread.model,
					})),
				};
			if (method === "stop") {
				setTimeout(() => {
					void close();
				}, 20);
				return {};
			}
			if (method === "unregister") {
				remove();
				return {};
			}
			if (method === "register") {
				const thread = params.thread as Record<string, unknown> | undefined;
				if (!thread || typeof thread.id !== "string" || thread.id.length > 256)
					throw new ProtocolError(-32602, "Invalid registration");
				if (router.sessions.has(thread.id) && owners.get(peer)?.id !== thread.id)
					throw new ProtocolError(-32000, "Session already has a live owner");
				if (!owners.has(peer) && owners.size >= 128) throw new ProtocolError(-32000, "Live session limit");
				const requests = router.validateSessionRequests(thread.id, params.requests ?? []);
				const skills = registrationSkills(params.skills);
				const skillErrors = registrationSkillErrors(params.skillErrors);
				if (owners.get(peer)?.id !== thread.id) remove();
				owners.set(peer, { id: thread.id, lastSeen: Date.now() });
				router.registerSession(thread.id, {
					thread,
					requests,
					skills,
					skillErrors,
					call: (identity, command, input) =>
						peer.call("session/call", { identity, method: command, params: input }),
				});
				return {};
			}
			if (method === "event") {
				const owner = owners.get(peer);
				const event = params.event as Notification | undefined;
				if (!owner || !event || event.params?.threadId !== owner.id || typeof event.method !== "string")
					throw new ProtocolError(-32602, "Invalid session event");
				router.publish(event);
				return {};
			}
			throw new ProtocolError(-32601, "Unsupported local host method");
		};
	});
	const sweep = setInterval(() => {
		for (const [peer, owner] of owners) if (Date.now() - owner.lastSeen > 30_000) peer.close();
	}, 5_000);
	async function close(): Promise<void> {
		if (closed) return;
		closed = true;
		router.dispose();
		clearInterval(sweep);
		stopRelay();
		for (const peer of peers) peer.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
		trace?.close();
	}
	function connectRelay(
		enrollment: Enrollment,
		installationId: string,
		name: string,
		refresh?: () => Promise<Enrollment>,
	): void {
		const codec = new RelayCodec();
		const clients = new Map<string, { clientId: string; streamId: string }>();
		let socket: WebSocket | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let attempts = 0;
		let refreshBeforeConnect = false;
		const send = (clientId: string, streamId: string, message: unknown, event?: string) => {
			if (!event || event === "server_message") trace?.record("rpc", "out", message);
			const frames = codec.send(clientId, streamId, message, event);
			if (socket?.readyState === WebSocket.OPEN)
				for (const frame of frames) {
					traceJson(trace, "relay", "out", frame);
					socket.send(frame);
				}
		};
		const connect = async () => {
			if (closed) return;
			if (refresh && (refreshBeforeConnect || Date.parse(enrollment.expires_at) < Date.now() + 60_000)) {
				try {
					Object.assign(enrollment, await refresh());
					refreshBeforeConnect = false;
				} catch {
					relayStatus = "credential-refresh-failed";
					timer = setTimeout(() => {
						void connect();
					}, 30_000);
					return;
				}
			}
			if (closed) return;
			if (!(Date.parse(enrollment.expires_at) > Date.now())) {
				relayStatus = "credential-expired";
				return;
			}
			relayStatus = "connecting";
			const connection = new WebSocket("wss://chatgpt.com/backend-api/wham/remote/control/server", {
				headers: {
					authorization: `Bearer ${enrollment.remote_control_token}`,
					"x-codex-server-id": enrollment.server_id,
					"x-codex-name": Buffer.from(name).toString("base64"),
					"x-codex-protocol-version": "3",
					"x-codex-installation-id": installationId,
					originator: "xcsh",
					"user-agent": `xcsh/${version}`,
					...(codec.cursor ? { "x-codex-subscribe-cursor": codec.cursor } : {}),
				},
			});
			socket = connection;
			connection.onopen = () => {
				if (socket !== connection) return;
				relayStatus = "connected";
				attempts = 0;
				for (const frame of codec.replay()) {
					traceJson(trace, "relay", "out", frame);
					connection.send(frame);
				}
			};
			connection.onmessage = event => {
				if (socket !== connection) return;
				try {
					if (typeof event.data !== "string") throw new Error();
					traceJson(trace, "relay", "in", event.data);
					const incoming = codec.receive(event.data);
					if (!incoming) return;
					const { clientId, streamId } = incoming;
					const key = JSON.stringify([clientId, streamId]);
					if (incoming.event === "ping") {
						send(clientId, streamId, router.isInitialized(key) ? "active" : "unknown", "pong");
						return;
					}
					if (incoming.event === "client_closed") {
						router.close(key);
						clients.delete(key);
						return;
					}
					clients.set(key, { clientId, streamId });
					trace?.record("rpc", "in", incoming.message);
					// Diagnostics contain protocol method names only, never payloads or client identifiers.
					const method = (incoming.message as { method?: string }).method;
					const safeMethod = typeof method === "string" && /^[a-zA-Z/]{1,128}$/.test(method) ? method : "invalid";
					if (method === "thread/realtime/start") {
						const p = (incoming.message as { params?: Record<string, unknown> }).params ?? {};
						const t = (p.transport as { type?: unknown } | undefined)?.type;
						process.stdout.write(
							`${JSON.stringify({ stage: "voice-shape", transport: ["existingCall", "webrtc", "websocket"].includes(String(t)) ? t : "unset", version: ["v1", "v2", "v3"].includes(String(p.version)) ? p.version : "unset", includeStartupContext: p.includeStartupContext !== false, flushTail: p.flushTranscriptTailOnSessionEnd === true, responseItems: p.codexResponsesAsItems === true, initialItems: Array.isArray(p.initialItems) ? p.initialItems.length : 0, startInstructions: typeof p.realtimeStartInstructions === "string" && p.realtimeStartInstructions.length > 0, endInstructions: typeof p.realtimeEndInstructions === "string" && p.realtimeEndInstructions.length > 0, at: Date.now() })}\n`,
						);
					}
					if (method === "turn/start" || method === "thread/settings/update") {
						const p = (incoming.message as { params?: Record<string, unknown> }).params ?? {};
						const target = router.sessions.get(String(p.threadId))?.thread;
						const effort = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(
							String(p.effort),
						)
							? p.effort
							: p.effort == null
								? "unset"
								: "other";
						process.stdout.write(
							`${JSON.stringify({ stage: "turn-shape", modelMatches: p.model == null || p.model === target?.model, cwdMatches: p.cwd == null || p.cwd === target?.cwd, effort, at: Date.now() })}\n`,
						);
					}
					if (method === "skills/extraRoots/set") {
						const p = (incoming.message as { params?: Record<string, unknown> }).params ?? {};
						process.stdout.write(
							`${JSON.stringify({ stage: "skills-shape", roots: Array.isArray(p.extraRoots) ? p.extraRoots.length : null, at: Date.now() })}\n`,
						);
					}
					if (method === "process/spawn") {
						const p = (incoming.message as { params?: Record<string, unknown> }).params ?? {};
						const command = Array.isArray(p.command) ? p.command : [];
						const executable = typeof command[0] === "string" ? (command[0].split("/").at(-1) ?? "") : "";
						const family = ["git", "bash", "sh", "zsh", "pwd"].includes(executable) ? executable : "other";
						const knownOperations = ["status", "rev-parse", "diff", "log", "ls-files"].filter(op =>
							command.some(arg => typeof arg === "string" && new RegExp(`\\b${op}\\b`).test(arg)),
						);
						process.stdout.write(
							`${JSON.stringify({ stage: "process-shape", family, knownOperations, argc: command.length, tty: p.tty === true, streamStdin: p.streamStdin === true, streamOutput: p.streamStdoutStderr === true, at: Date.now() })}\n`,
						);
					}
					if (typeof method === "string" && /^[a-zA-Z/]+$/.test(method))
						process.stdout.write(
							`${JSON.stringify({ stage: "relay", method, parameterKeys: Object.keys((incoming.message as { params?: Record<string, unknown> }).params ?? {}).filter(key => /^[a-zA-Z]+$/.test(key)), at: Date.now() })}\n`,
						);
					void router
						.handle(key, incoming.message)
						.then(result => {
							if (result !== null) {
								const error = (result as { error?: { code: number } }).error;
								if (error)
									process.stdout.write(
										`${JSON.stringify({ stage: "relay", method: safeMethod, errorCode: error.code, at: Date.now() })}\n`,
									);
								send(clientId, streamId, result);
							}
						})
						.catch(() => {
							relayStatus = "protocol-error";
							if (socket === connection) connection.close();
						});
				} catch {
					relayStatus = "protocol-error";
					if (socket === connection) connection.close();
				}
			};
			connection.onerror = () => {
				if (socket !== connection) return;
				relayStatus = "connection-error";
				refreshBeforeConnect = true;
				connection.close();
			};
			connection.onclose = () => {
				if (socket !== connection) return;
				socket = undefined;
				if (!closed) {
					relayStatus = "reconnecting";
					if (timer) clearTimeout(timer);
					timer = setTimeout(
						() => {
							timer = undefined;
							void connect();
						},
						Math.min(30_000, 500 * 2 ** Math.min(attempts++, 6)),
					);
				}
			};
		};
		publishClient = (key, event) => {
			const client = clients.get(key);
			if (!client) return;
			try {
				send(client.clientId, client.streamId, event);
			} catch {
				relayStatus = "buffer-limit";
				socket?.close();
			}
		};

		let refreshing = false;
		const refreshTimer = setInterval(() => {
			if (!refresh || refreshing || closed || Date.parse(enrollment.expires_at) > Date.now() + 60_000) return;
			refreshing = true;
			void refresh()
				.then(
					next => {
						Object.assign(enrollment, next);
					},
					() => {
						if (Date.parse(enrollment.expires_at) <= Date.now()) socket?.close();
					},
				)
				.finally(() => {
					refreshing = false;
				});
		}, 30_000);
		stopRelay = () => {
			clearInterval(refreshTimer);
			if (timer) clearTimeout(timer);
			socket?.close();
		};
		void connect();
	}
	return { router, close, connectRelay };
}
