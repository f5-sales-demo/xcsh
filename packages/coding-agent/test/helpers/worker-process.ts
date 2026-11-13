import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
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

const issuedPorts = new Set<number>();
const [ephemeralStart, ephemeralEnd] =
	process.platform === "linux"
		? readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number)
		: [49152, 65535];

/** Avoid automatic outbound allocation while the child starts, and never reuse
 * a port from another fixture in this process. An external explicit listener
 * can still race the handoff; its startup error must remain visible.
 */
export function reserveWorkerPort(): number {
	for (let attempt = 0; attempt < 1000; attempt++) {
		const port = randomInt(10000, 30000);
		if (issuedPorts.has(port) || (port >= ephemeralStart && port <= ephemeralEnd)) continue;
		try {
			const reservation = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("reserved") });
			reservation.stop(true);
			issuedPorts.add(port);
			return port;
		} catch (error) {
			if (!(error instanceof Error) || !/EADDRINUSE|address already in use|in use/i.test(error.message)) throw error;
		}
	}
	throw new Error("No unused worker fixture port outside the automatic outbound range");
}

/** Own one subprocess and a dedicated loopback port; retain startup evidence and await closure. */
export async function spawnWorkerProcess(
	command: string[],
	options: {
		cwd: string;
		env: Record<string, string | undefined>;
	},
) {
	const port = reserveWorkerPort();
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
