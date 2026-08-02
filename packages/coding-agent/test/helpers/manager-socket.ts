/** Read the version reported by the manager control socket, or null when it is not ready. */
async function managerVersion(target: string, timeoutMs: number): Promise<string | null> {
	const { promise, resolve } = Promise.withResolvers<string | null>();
	let settled = false;
	const finish = (version: string | null) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		resolve(version);
	};
	const timer = setTimeout(() => finish(null), timeoutMs);
	let buffer = "";
	Bun.connect({
		unix: target,
		socket: {
			open(socket) {
				socket.write(`${JSON.stringify({ type: "hello" })}\n`);
			},
			data(socket, data) {
				buffer += data.toString("utf8");
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				try {
					const acknowledgement = JSON.parse(buffer.slice(0, newline)) as { version?: unknown };
					finish(typeof acknowledgement.version === "string" ? acknowledgement.version : null);
				} catch {
					finish(null);
				}
				socket.end();
			},
			error: () => finish(null),
		},
	}).catch(() => finish(null));
	return promise;
}

/** Wait for the manager's real handshake rather than treating a socket path as readiness. */
export async function waitForManagerVersion(target: string, expected: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const remaining = deadline - Date.now();
		if ((await managerVersion(target, Math.min(500, remaining))) === expected) return true;
		await Bun.sleep(100);
	}
	return false;
}
