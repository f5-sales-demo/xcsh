import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerWebSocket } from "bun";
import { isVoiceRequest, type VoiceFrame } from "../../../chat-ui/src/voice/contract";
import { LOCALIP_HOST, resolveBridgeTls } from "../browser/bridge-cert";
import clientSource from "../browser/voice-companion.generated.min.js" with { type: "text" };
import { SelectedChatVoice } from "./selected-chat-voice";
import type { SessionTarget } from "./session";
import { voiceCoordinatorFor } from "./voice-coordinator";

const MAX_CONNECTIONS = 4;
const MAX_CLIENT_IDENTITIES = 8;
type CompanionSocket = ServerWebSocket<{
	authenticated: boolean;
	clientId: string;
	clientIds: Set<string>;
	timer?: ReturnType<typeof setTimeout>;
}>;

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>xcsh</title><link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-capable" content="yes"><style>body{font:16px system-ui;max-width:50rem;margin:1rem auto;padding:1rem;background:#111;color:#eee}button,input{font:inherit;margin:.3rem}#app{min-height:90vh}</style></head><body><main id="app"></main><script type="module" src="/client.js"></script></body></html>`;

/** Application credentials admit bounded control connections; the coordinator owns audio. */
export class CompanionAdmission {
	#claims = 0;
	#established = false;
	constructor(
		private readonly token: string,
		private readonly chatId: string,
		private readonly expiresAt: number,
	) {}
	release(): void {
		this.#claims = Math.max(0, this.#claims - 1);
	}
	claim(token: unknown, currentChatId: string, now = Date.now()): boolean {
		if (
			this.#claims >= MAX_CONNECTIONS ||
			currentChatId !== this.chatId ||
			(!this.#established && now > this.expiresAt) ||
			typeof token !== "string"
		)
			return false;
		const actual = Buffer.from(token),
			expected = Buffer.from(this.token);
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
		this.#claims++;
		this.#established = true;
		return true;
	}
}

export async function startVoiceCompanion(
	target: SessionTarget,
	emit: (event: VoiceFrame) => void,
): Promise<{ url: string; close(): Promise<void>; control(action: string): void }> {
	const certificate = process.env.XCSH_VOICE_COMPANION_CERT,
		privateKey = process.env.XCSH_VOICE_COMPANION_KEY;
	if (!!certificate !== !!privateKey) throw new Error("Both companion TLS paths are required");
	const tls =
		certificate && privateKey
			? { cert: await readFile(certificate), key: await readFile(privateKey) }
			: await resolveBridgeTls();
	const hostname = process.env.XCSH_VOICE_COMPANION_PUBLIC_HOST ?? LOCALIP_HOST;
	const bind = process.env.XCSH_VOICE_COMPANION_BIND ?? "127.0.0.1";
	if (!/^[A-Za-z0-9.-]+$/.test(hostname) || !/^[A-Za-z0-9.:_-]+$/.test(bind))
		throw new Error("Invalid companion host");
	if (!tls) throw new Error("Trusted companion HTTPS is unavailable");
	const chatId = target.sessionId;
	const token = randomBytes(32).toString("base64url");
	const admission = new CompanionAdmission(token, chatId, Date.now() + 300_000);
	const clients = new Set<CompanionSocket>();
	const identities = new Map<string, CompanionSocket>();
	const disconnects = new Set<Promise<void>>();
	let closing: Promise<void> | undefined;
	let origin = "";
	const deliver = (event: VoiceFrame) => {
		emit(event);
		const frame = JSON.stringify(event);
		for (const client of clients)
			if (client.data.authenticated && (!event.clientId || client.data.clientIds.has(event.clientId)))
				client.send(frame);
	};
	const voice = new SelectedChatVoice(target, deliver);
	const server = Bun.serve<CompanionSocket["data"]>({
		port: 0,
		hostname: bind,
		tls: { cert: tls.cert, key: tls.key },
		fetch(request, service) {
			const url = new URL(request.url);
			if (closing || target.sessionId !== chatId || request.method !== "GET")
				return new Response(null, { status: 403 });
			if (url.pathname === "/events") {
				if (clients.size >= MAX_CONNECTIONS || ![origin, url.origin].includes(request.headers.get("origin") ?? ""))
					return new Response(null, { status: 403 });
				if (
					service.upgrade(request, {
						data: { authenticated: false, clientId: crypto.randomUUID(), clientIds: new Set<string>() },
					})
				)
					return;
				return new Response(null, { status: 426 });
			}
			const headers = {
				"Cache-Control": "no-store",
				"Referrer-Policy": "no-referrer",
				"X-Content-Type-Options": "nosniff",
				"Permissions-Policy": "microphone=(self)",
				"Content-Security-Policy":
					"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; media-src blob:; manifest-src 'self'; frame-ancestors 'none'",
			};
			if (url.pathname === "/")
				return new Response(page, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
			if (url.pathname === "/manifest.webmanifest")
				return Response.json(
					{
						name: "xcsh voice",
						short_name: "xcsh",
						start_url: "/",
						display: "standalone",
						background_color: "#111111",
						theme_color: "#111111",
					},
					{ headers },
				);
			if (url.pathname === "/client.js")
				return new Response(clientSource, {
					headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
				});
			return new Response(null, { status: 404 });
		},
		websocket: {
			maxPayloadLength: 262_144,
			open(socket) {
				if (closing || clients.size >= MAX_CONNECTIONS) {
					socket.close(1008);
					return;
				}
				clients.add(socket);
				socket.data.timer = setTimeout(() => socket.close(1008), 5000);
			},
			message(socket, data) {
				try {
					const message = JSON.parse(String(data));
					if (!socket.data.authenticated) {
						if (message.type !== "voice_hello" || !admission.claim(message.token, target.sessionId)) {
							socket.close(1008);
							return;
						}
						socket.data.authenticated = true;
						clearTimeout(socket.data.timer);
						clearTimeout(unused);
						return;
					}
					if (
						!isVoiceRequest(message) ||
						target.sessionId !== chatId ||
						(message.action !== "capabilities" && message.chatId !== chatId) ||
						message.action === "companion" ||
						(message.clientId !== undefined &&
							(typeof message.clientId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(message.clientId)))
					) {
						socket.close(1008);
						return;
					}
					const clientId = message.clientId ?? socket.data.clientId;
					const registered = identities.get(clientId);
					if (
						(registered && registered !== socket) ||
						(!registered && (message.action !== "capabilities" || identities.size >= MAX_CLIENT_IDENTITIES))
					) {
						socket.close(1008);
						return;
					}
					identities.set(clientId, socket);
					socket.data.clientIds.add(clientId);
					void voice.handle({ ...message, clientId });
				} catch {
					socket.close(1008);
				}
			},
			close(socket) {
				clearTimeout(socket.data.timer);
				if (!clients.delete(socket)) return;
				if (socket.data.authenticated) admission.release();
				for (const clientId of socket.data.clientIds) {
					if (identities.get(clientId) === socket) identities.delete(clientId);
					const task = voice
						.disconnectClient(clientId)
						.catch(() => {
							deliver({
								type: "voice_event",
								chatId,
								clientId,
								method: "xcsh/voice/error",
								params: {
									message:
										"Disconnected voice cleanup is unconfirmed. End previous voice before starting again.",
								},
							});
						})
						.finally(() => {
							disconnects.delete(task);
						});
					disconnects.add(task);
				}
			},
		},
	});
	origin = `https://${hostname}:${server.port}`;
	const unused = setTimeout(() => {
		void close();
	}, 300_000);
	async function close(): Promise<void> {
		if (!closing)
			closing = Promise.all([voice.close(), ...disconnects])
				.then(() => {})
				.finally(() => {
					clearTimeout(unused);
					for (const client of clients) client.close();
					server.stop(true);
				});
		await closing;
	}
	return {
		url: `${origin}/#${token}`,
		close,
		control: action => {
			if (closing || target.sessionId !== chatId) return;
			const clientId = voiceCoordinatorFor(target, chatId).snapshot?.clientId;
			if (["mute", "unmute", "pause", "resume", "interrupt", "devices"].includes(action))
				void voice.handle({
					type: "voice_request",
					...(clientId && identities.has(clientId) ? { clientId } : {}),
					action: action as import("../../../chat-ui/src/voice/contract").VoiceAction,
					chatId,
					requestId: crypto.randomUUID(),
				});
		},
	};
}
