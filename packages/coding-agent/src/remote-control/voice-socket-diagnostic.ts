/// <reference path="./ws-diagnostic.d.ts" />
import { randomUUID } from "node:crypto";
import { Agent as HttpsAgent } from "node:https";
import { join } from "node:path";
import { connect as connectTls } from "node:tls";
import WebSocket from "ws-diagnostic";
import type { TraceSink } from "./trace-runtime";
import { traceJson } from "./trace-runtime";
import type { VoiceHandlers, VoiceSocket } from "./voice-socket";
import { openPrivateTlsKeyLog } from "./voice-tls-keylog";
/** Explicit lab connector: records status only, never URLs, headers or error bodies. */
export function openDiagnosticVoiceSocket(
	url: string,
	headers: Record<string, string>,
	handlers: VoiceHandlers,
	trace?: TraceSink,
	signal?: AbortSignal,
): Promise<VoiceSocket> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			trace?.record("connection", "in", { type: "cancelled", opened: false });
			trace?.close();
			reject(new Error("Realtime connection cancelled"));
			return;
		}
		const keyDirectory = process.env.XCSH_VOICE_TLS_KEY_DIRECTORY;
		const keyLog =
			keyDirectory && url.startsWith("wss://")
				? openPrivateTlsKeyLog(join(keyDirectory, `voice-${randomUUID()}.keys`))
				: undefined;
		const agent = keyLog ? new HttpsAgent() : undefined;
		if (agent)
			agent.createConnection = ((options: Parameters<typeof connectTls>[0]) => {
				const tlsSocket = connectTls(options);
				tlsSocket.on("keylog", line => {
					try {
						keyLog!.write(line);
					} catch {
						tlsSocket.destroy(new Error("TLS key capture failed"));
					}
				});
				return tlsSocket;
			}) as typeof agent.createConnection;
		const socket = new WebSocket(url, {
			headers,
			followRedirects: false,
			handshakeTimeout: 15000,
			...(agent ? { agent } : {}),
		});

		let opened = false;
		let ended = false;
		let captureClosed = false;
		let localCloseRequested = false;
		const closeCapture = () => {
			if (!captureClosed) {
				captureClosed = true;
				trace?.close();
				keyLog?.close();
				agent?.destroy();
			}
		};
		const cleanup = () => signal?.removeEventListener("abort", cancel);
		const fail = (message: string, facts: Record<string, unknown>) => {
			if (ended) return;
			ended = true;
			cleanup();
			trace?.record("connection", "in", facts);
			closeCapture();
			socket.terminate();
			reject(new Error(message));
		};
		const cancel = () => {
			if (!opened) fail("Realtime connection cancelled", { type: "cancelled", opened: false });
		};
		signal?.addEventListener("abort", cancel, { once: true });
		socket.on("unexpected-response", (_request, response) => {
			const status = response.statusCode;
			response.destroy();
			fail(`Native realtime connection failed (HTTP ${status})`, {
				type: "error",
				opened: false,
				httpStatus: status,
			});
		});
		socket.on("open", () => {
			if (ended) {
				socket.terminate();
				return;
			}
			opened = true;
			cleanup();
			trace?.record("connection", "in", { type: "open" });
			resolve({
				send(data) {
					traceJson(trace, "realtime", "out", data);
					return socket.send(data);
				},
				close() {
					localCloseRequested = true;
					socket.close();
				},
				get bufferedAmount() {
					return socket.bufferedAmount;
				},
			});
		});
		socket.on("message", (data, binary) => {
			if (ended) return;
			if (binary) {
				trace?.record("connection", "in", { type: "binary" });
				handlers.message("");
			} else {
				const text = data.toString();
				traceJson(trace, "realtime", "in", text);
				handlers.message(text);
			}
		});
		socket.on("error", error => {
			if (ended) return;
			if (!opened) {
				const code = (error as NodeJS.ErrnoException).code;
				const safeCode =
					typeof code === "string" &&
					/^(?:E[A-Z0-9_]{1,40}|CERT_[A-Z0-9_]{1,40}|ERR_TLS_[A-Z0-9_]{1,40})$/.test(code)
						? code
						: undefined;
				fail("Native realtime transport failed", {
					type: "error",
					opened: false,
					...(safeCode ? { transportErrorCode: safeCode } : {}),
				});
			} else {
				trace?.record("connection", "in", { type: "error", opened: true });
				handlers.closed();
			}
		});
		socket.on("close", (code, reason) => {
			if (ended) return;
			ended = true;
			cleanup();
			trace?.record("connection", "in", {
				type: "closed",
				opened,
				closeCode: code,
				closeReasonBytes: reason.byteLength,
				localCloseRequested,
			});
			closeCapture();
			if (opened) handlers.closed();
			else reject(new Error("Realtime connection closed"));
		});
	});
}
