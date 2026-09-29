import { probe } from "./bridge-probe";

function captureOutput(stream: ReadableStream<Uint8Array>) {
	let tail = "";
	const drained = (async () => {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				tail = (tail + decoder.decode(value, { stream: true })).slice(-4096);
			}
			tail = (tail + decoder.decode()).slice(-4096);
		} finally {
			reader.releaseLock();
		}
	})().catch(error => {
		tail = `${tail}\noutput capture: ${String(error)}`.slice(-4096);
	});
	return { drained, text: () => tail };
}

/** Own one subprocess and ephemeral loopback port; retain startup evidence and reap before reuse. */
export async function spawnWorkerProcess(
	command: string[],
	options: {
		cwd: string;
		env: Record<string, string | undefined>;
	},
) {
	const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
	const port = reservation.port as number;
	reservation.stop(true);
	const proc = Bun.spawn(command, {
		...options,
		env: { ...options.env, XCSH_BRIDGE_PORT: String(port) },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = captureOutput(proc.stdout);
	const stderr = captureOutput(proc.stderr);
	let hasExited = false;
	const exited = proc.exited.then(code => {
		hasExited = true;
		return code;
	});
	const diagnostics = () => `port=${port}\nstdout: ${stdout.text()}\nstderr: ${stderr.text()}`;
	async function ready(timeoutMs = 15_000) {
		const deadline = Date.now() + timeoutMs;
		let lastError = "no handshake";
		while (Date.now() < deadline) {
			if (hasExited) {
				await Promise.all([stdout.drained, stderr.drained]);
				const cause = proc.signalCode ? `signal ${proc.signalCode}` : `code ${proc.exitCode}`;
				throw new Error(`Worker exited with ${cause} before its handshake; ${diagnostics()}`);
			}
			try {
				return await probe(port, Math.max(1, Math.min(500, deadline - Date.now())));
			} catch (error) {
				lastError = String(error);
			}
			await Bun.sleep(Math.max(0, Math.min(250, deadline - Date.now())));
		}
		throw new Error(`Worker startup deadline (${timeoutMs}ms) exceeded: ${lastError}; ${diagnostics()}`);
	}
	async function stop() {
		if (!hasExited) proc.kill();
		const forceKill = setTimeout(() => {
			if (!hasExited) proc.kill("SIGKILL");
		}, 1000);
		try {
			await exited;
			await Promise.all([stdout.drained, stderr.drained]);
		} finally {
			clearTimeout(forceKill);
		}
	}
	return { port, proc, ready, stop };
}
