/**
 * Shared test helper: the `hello` / `hello_ack` WebSocket handshake against an
 * extension-bridge worker.
 *
 * The bridge runs WITH origin checking (mirroring main.ts / the worker), so the
 * probe presents the extension's `Origin` header. The origin is derived from
 * `EXTENSION_ID` — the SAME source the worker's origin check reads — so the two
 * can never drift.
 *
 * Consumed by both `worker-spawn.int.test.ts` (Task 4) and `manager.int.test.ts`
 * (Task 5); do not inline a copy.
 */
import { EXTENSION_CONTRACT_VERSION } from "../../src/browser/capabilities.generated";
import { EXTENSION_ID } from "../../src/browser/extension-identity";

/** The `Origin` header the bridge's origin check expects. */
export const PROBE_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
/** The exact browser handshake accepted by the contract-2 bridge. */
export const PROBE_HELLO = {
	type: "hello",
	contractVersion: EXTENSION_CONTRACT_VERSION,
	extensionId: EXTENSION_ID,
} as const;

/**
 * Perform ONE `hello` / `hello_ack` handshake against the bridge on `port`.
 * Resolves the parsed ack frame, or rejects on socket error / timeout. Callers
 * wrap this in a retry loop while a worker is still coming up.
 */
export function probe(port: number, timeoutMs = 500): Promise<Record<string, unknown>> {
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
			headers: { Origin: PROBE_ORIGIN },
		} as unknown as string[]);
		const timer = setTimeout(() => {
			try {
				ws.close();
			} catch {
				/* already closing */
			}
			reject(new Error("probe timeout"));
		}, timeoutMs);
		ws.onopen = () => ws.send(JSON.stringify(PROBE_HELLO));
		ws.onmessage = e => {
			// The bridge multiplexes typed frames on this socket: the `hello_ack`
			// handshake answer plus `type:"span"` TTFT telemetry emitted during a
			// (cold) session build. Only the ack answers this probe — skip any other
			// frame and keep waiting so a span that races ahead of the ack can't be
			// mistaken for it (#2207).
			let frame: Record<string, unknown>;
			try {
				frame = JSON.parse(e.data as string) as Record<string, unknown>;
			} catch {
				return; // ignore malformed frames; wait for the ack or the timeout
			}
			if (frame.type !== "hello_ack") return;
			clearTimeout(timer);
			resolve(frame);
			ws.close();
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("ws error"));
		};
	});
}
