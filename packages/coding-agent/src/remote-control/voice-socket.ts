import { VERSION } from "@f5-sales-demo/pi-utils";
import { type TraceSink, traceFromEnvironment, traceJson } from "./trace-runtime";

export interface VoiceSocket {
	send(data: string): unknown;
	close(): void;
	readonly bufferedAmount: number;
}
export interface VoiceHandlers {
	message(data: string): void;
	closed(): void;
}
/** Bun reports rejected upgrades without the HTTP status. Never invent one or log the URL. */
export async function openVoiceSocket(
	url: string,
	headers: Record<string, string>,
	handlers: VoiceHandlers,
	trace: TraceSink | undefined = traceFromEnvironment("voice", VERSION),
): Promise<VoiceSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		let opened = false;
		const timeout = setTimeout(() => {
			trace?.record("connection", "in", { type: "timeout" });
			trace?.close();
			socket.close();
			reject(new Error("Realtime connection timeout"));
		}, 15_000);
		socket.onopen = () => {
			clearTimeout(timeout);
			opened = true;
			trace?.record("connection", "in", { type: "open" });
			resolve({
				send(data) {
					traceJson(trace, "realtime", "out", data);
					return socket.send(data);
				},
				close() {
					socket.close();
				},
				get bufferedAmount() {
					return socket.bufferedAmount;
				},
			});
		};
		socket.onmessage = event => {
			if (typeof event.data === "string") traceJson(trace, "realtime", "in", event.data);
			else trace?.record("connection", "in", { type: "binary" });
			handlers.message(typeof event.data === "string" ? event.data : "");
		};
		socket.onerror = event => {
			trace?.record("connection", "in", { type: "error", opened });
			clearTimeout(timeout);
			if (!opened)
				reject(
					new Error(
						/Expected 101 status code/i.test(String((event as ErrorEvent).message))
							? "Realtime WebSocket upgrade rejected"
							: "Native realtime transport failed",
					),
				);
			else handlers.closed();
		};
		socket.onclose = () => {
			trace?.record("connection", "in", { type: "closed", opened });
			trace?.close();
			clearTimeout(timeout);
			if (!opened) reject(new Error("Realtime connection closed"));
			else handlers.closed();
		};
	});
}
