import { join } from "node:path";
import { getAgentDir, VERSION } from "@f5-sales-demo/pi-utils";
import { connectPeer, type LocalPeer } from "./ipc";
import { ProtocolError, RemoteSession, type SessionTarget } from "./session";
export function remoteSocketPath(): string {
	return join(getAgentDir(), "remote-control", "host.sock");
}
/** Attach only from InteractiveMode. Internal task/print/RPC agents never invoke this hook. */
export function startSessionBridge(
	target: SessionTarget,
	socketPath = remoteSocketPath(),
	intervalMs = 5_000,
): () => void {
	const remote = new RemoteSession(target, VERSION);
	let peer: LocalPeer | undefined;
	let busy = false;
	let stopped = false;
	const update = async () => {
		if (stopped || busy) return;
		busy = true;
		try {
			if (!peer) {
				const connected = await connectPeer(socketPath);
				if (stopped) {
					connected.close();
					return;
				}
				peer = connected;
				connected.onClose = () => {
					if (peer === connected) peer = undefined;
				};
				connected.handle = async (method, params) => {
					if (
						method !== "session/call" ||
						typeof params.identity !== "string" ||
						typeof params.method !== "string" ||
						!params.params ||
						typeof params.params !== "object"
					)
						throw new ProtocolError(-32602, "Invalid session request");
					return remote.call(params.identity, params.method, params.params as Record<string, unknown>);
				};
			}
			await peer.call("register", { thread: remote.thread() });
		} catch {
			peer?.close();
			peer = undefined;
		} finally {
			busy = false;
		}
	};
	const unsubscribe = remote.subscribe(event => {
		void peer?.call("event", { event }).catch(() => {
			peer?.close();
		});
	});
	const timer = setInterval(() => {
		void update();
	}, intervalMs);
	timer.unref();
	void update();
	return () => {
		stopped = true;
		clearInterval(timer);
		unsubscribe();
		remote.dispose();
		peer?.close();
	};
}
