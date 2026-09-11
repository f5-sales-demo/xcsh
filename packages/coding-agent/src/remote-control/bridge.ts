import { join } from "node:path";
import { getAgentDir, VERSION } from "@f5-sales-demo/pi-utils";
import { connectPeer, type LocalPeer } from "./ipc";
import { ProtocolError, RemoteSession, type RemoteSessionControls, type SessionTarget } from "./session";
export function remoteSocketPath(): string {
	return join(getAgentDir(), "remote-control", "host.sock");
}
/** Attach only from InteractiveMode. Internal task/print/RPC agents never invoke this hook. */
export function startSessionBridge(
	target: SessionTarget,
	socketPath = remoteSocketPath(),
	intervalMs = 5_000,
	controls: RemoteSessionControls = {},
): () => Promise<void> {
	const remote = new RemoteSession(target, VERSION, controls);
	let peer: LocalPeer | undefined;
	let pending: Promise<void> | undefined;
	let changing = false;
	let stopped = false;
	let closing: Promise<void> | undefined;
	const events = new Set<Promise<void>>();
	const update = (duringTransition = false): Promise<void> => {
		if (stopped || (changing && !duringTransition)) return Promise.resolve();
		if (pending) return pending;
		pending = (async () => {
			try {
				if (!peer) {
					const connected = await connectPeer(socketPath);
					if (stopped || (changing && !duringTransition)) {
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
						if (changing) throw new ProtocolError(-32000, "Session is changing");
						return remote.call(params.identity, params.method, params.params as Record<string, unknown>);
					};
				}
				const catalog = remote.skills();
				await peer.call("register", {
					thread: remote.thread(),
					requests: remote.pendingRequests(),
					skills: catalog.skills,
					skillErrors: catalog.errors,
				});
			} catch {
				peer?.close();
				peer = undefined;
			}
		})().finally(() => {
			pending = undefined;
		});
		return pending;
	};
	const unsubscribe = remote.subscribe(event => {
		const current = peer;
		if (!current) return;
		const sent = current.call("event", { event }).then(
			() => {},
			() => {
				current.close();
			},
		);
		events.add(sent);
		void sent.finally(() => {
			events.delete(sent);
		});
	});
	const unsubscribeTransitions = target.subscribeSessionTransitions?.(async phase => {
		if (phase === "before") {
			changing = true;
			await pending;
		} else {
			try {
				await update(true);
			} finally {
				changing = false;
			}
		}
	});
	const timer = setInterval(() => {
		void update();
	}, intervalMs);
	timer.unref();
	void update();
	const stop = (): Promise<void> => {
		if (closing) return closing;
		stopped = true;
		clearInterval(timer);
		unsubscribeTransitions?.();
		unsubscribeDispose?.();
		closing = (async () => {
			try {
				await remote.close();
				await pending;
				await Promise.allSettled([...events]);
				await peer?.call("unregister", {}).catch(() => {});
			} finally {
				unsubscribe();
				peer?.close();
			}
		})();
		return closing;
	};
	const unsubscribeDispose = target.addBeforeDisposeHook?.(stop);
	return stop;
}
