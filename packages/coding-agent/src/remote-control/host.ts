import { dirname } from "node:path";
import type { Enrollment } from "./enrollment";
import { type LocalPeer, listenLocal } from "./ipc";
import { RelayCodec } from "./relay";
import { RemoteRouter } from "./router";
import { type Notification, ProtocolError } from "./session";
export async function startLocalHost(socketPath: string, version: string) {
	const router = new RemoteRouter(dirname(socketPath), version);
	const peers = new Set<LocalPeer>();
	const owners = new Map<LocalPeer, { id: string; lastSeen: number }>();
	let closed = false;
	let relayStatus = "disconnected";
	let publish = (_notification: Notification) => {};
	let stopRelay = () => {};
	const server = await listenLocal(socketPath, peer => {
		peers.add(peer);
		const localClient = `local-${crypto.randomUUID()}`;
		const remove = () => {
			const owner = owners.get(peer);
			if (owner) router.sessions.delete(owner.id);
			owners.delete(peer);
		};
		peer.onClose = () => {
			router.close(localClient);
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
			if (method === "register") {
				const thread = params.thread as Record<string, unknown> | undefined;
				if (!thread || typeof thread.id !== "string" || thread.id.length > 256)
					throw new ProtocolError(-32602, "Invalid registration");
				if (router.sessions.has(thread.id) && owners.get(peer)?.id !== thread.id)
					throw new ProtocolError(-32000, "Session already has a live owner");
				if (!owners.has(peer) && owners.size >= 128) throw new ProtocolError(-32000, "Live session limit");
				remove();
				owners.set(peer, { id: thread.id, lastSeen: Date.now() });
				router.sessions.set(thread.id, {
					thread,
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
				publish(event);
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
		clearInterval(sweep);
		stopRelay();
		for (const peer of peers) peer.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
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
		const send = (clientId: string, streamId: string, message: unknown, event?: string) => {
			const frames = codec.send(clientId, streamId, message, event);
			if (socket?.readyState === WebSocket.OPEN) for (const frame of frames) socket.send(frame);
		};
		const connect = async () => {
			if (closed) return;
			if (refresh && Date.parse(enrollment.expires_at) < Date.now() + 60_000) {
				try {
					Object.assign(enrollment, await refresh());
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
			socket = new WebSocket("wss://chatgpt.com/backend-api/wham/remote/control/server", {
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
			socket.onopen = () => {
				relayStatus = "connected";
				attempts = 0;
				for (const frame of codec.replay()) socket?.send(frame);
			};
			socket.onmessage = event => {
				try {
					if (typeof event.data !== "string") throw new Error();
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
					// Diagnostics contain protocol method names only, never payloads or client identifiers.
					const method = (incoming.message as { method?: string }).method;
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
										`${JSON.stringify({ stage: "relay", errorCode: error.code, at: Date.now() })}\n`,
									);
								send(clientId, streamId, result);
							}
						})
						.catch(() => {
							relayStatus = "protocol-error";
							socket?.close();
						});
				} catch {
					relayStatus = "protocol-error";
					socket?.close();
				}
			};
			socket.onerror = () => {
				relayStatus = "connection-error";
			};
			socket.onclose = () => {
				if (!closed) {
					relayStatus = "reconnecting";
					timer = setTimeout(
						() => {
							void connect();
						},
						Math.min(30_000, 500 * 2 ** Math.min(attempts++, 6)),
					);
				}
			};
		};
		publish = event => {
			for (const [key, client] of clients)
				if (router.subscribed(key, String(event.params.threadId))) {
					try {
						send(client.clientId, client.streamId, event);
					} catch {
						relayStatus = "buffer-limit";
						socket?.close();
					}
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
