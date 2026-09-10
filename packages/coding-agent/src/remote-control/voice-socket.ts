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
): Promise<VoiceSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		let opened = false;
		const timeout = setTimeout(() => {
			socket.close();
			reject(new Error("Realtime connection timeout"));
		}, 15_000);
		socket.onopen = () => {
			clearTimeout(timeout);
			opened = true;
			resolve(socket);
		};
		socket.onmessage = event => {
			handlers.message(typeof event.data === "string" ? event.data : "");
		};
		socket.onerror = event => {
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
			clearTimeout(timeout);
			if (!opened) reject(new Error("Realtime connection closed"));
			else handlers.closed();
		};
	});
}
