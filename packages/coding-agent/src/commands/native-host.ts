/**
 * `chrome-host` — native-messaging relay subcommand.
 *
 * Launched by Chrome as the native-messaging host. It is a thin relay between
 * Chrome's stdio (native-messaging framing: 4-byte LE length + JSON) and the
 * long-lived `xcsh manager` control server's UNIX socket (newline-delimited
 * JSON). No business logic lives here.
 *
 * Unlike a plain relay, the host ENSURES the manager before relaying: if the
 * control socket can't be connected (manager not yet running), it spawns a
 * DETACHED, long-lived `xcsh manager` and retries with a short backoff. The
 * ensure is idempotent — if the first connect succeeds no manager is spawned,
 * so we never launch two. If the manager still can't be reached after the
 * backoff we exit cleanly (0); the extension retries the whole bootstrap.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "@f5-sales-demo/pi-utils/cli";
// Lean subpath (not the barrel) to keep the relay's cold start minimal.
import { VERSION } from "@f5-sales-demo/pi-utils/dirs";
import { decodeNm, encodeNm } from "../browser/native-messaging";
import { readManagerState } from "../services/manager-state";
import { reexecArgv } from "./manager";
import { shouldSupersede } from "./manager-core";

/** Manager control socket — MUST match `commands/manager.ts` exactly. */
const SOCKET_PATH = process.env.XCSH_MANAGER_SOCK ?? join(homedir(), ".xcsh", "manager.sock");

/** Connect-retry budget after (re)spawning the manager: ~2s total. */
const CONNECT_RETRIES = 20;
const CONNECT_BACKOFF_MS = 100;

// Diagnostic relay tracing, OFF unless ~/.xcsh/chrome-host-debug exists. Security:
// writes to a 0600 file in the user's home, lifecycle + byte-counts ONLY — never
// message content — and never to stdout (that would corrupt the NM stream).
function dbg(msg: string): void {
	try {
		const fs = require("node:fs");
		const home = process.env.HOME || homedir();
		if (!fs.existsSync(join(home, ".xcsh", "chrome-host-debug"))) return;
		const fd = fs.openSync(join(home, ".xcsh", "chrome-host.log"), "a", 0o600);
		fs.appendFileSync(fd, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`);
		fs.closeSync(fd);
	} catch {
		/* logging must never break the relay */
	}
}

type Sock = Awaited<ReturnType<typeof Bun.connect>>;

export default class ChromeHost extends Command {
	static description = "Native-messaging relay between Chrome and the xcsh manager socket (internal)";

	async run(): Promise<void> {
		let socketBuffer = "";
		const socketHandlers = {
			data(_sock: Sock, chunk: Uint8Array): void {
				// Manager → Chrome: NDJSON lines → native-messaging frames.
				socketBuffer += new TextDecoder().decode(chunk);
				let newlineIndex = socketBuffer.indexOf("\n");
				while (newlineIndex !== -1) {
					const line = socketBuffer.slice(0, newlineIndex);
					socketBuffer = socketBuffer.slice(newlineIndex + 1);
					if (line.length > 0) {
						dbg(`socket→chrome ${line.length}B`);
						// Guard the parse/encode: a malformed manager line would otherwise
						// throw INSIDE this Bun socket callback. Drop it (trace only) — never
						// surface the error on stdout, which is the native-messaging stream.
						try {
							process.stdout.write(encodeNm(JSON.parse(line)));
						} catch {
							dbg("socket→chrome drop: malformed line");
						}
					}
					newlineIndex = socketBuffer.indexOf("\n");
				}
			},
			close(): void {
				dbg("manager socket closed → exit");
				process.exit(0);
			},
			error(): void {
				dbg("manager socket error → exit");
				process.exit(0);
			},
		};

		dbg(`start sock=${SOCKET_PATH} argc=${process.argv.length}`);
		const socket = await this.ensureManager(socketHandlers);
		if (!socket) {
			// Manager unreachable after ensure — exit cleanly; the extension retries.
			dbg("ensureManager: unreachable → exit");
			process.exit(0);
		}

		// Chrome stdin → manager: native-messaging frames → NDJSON lines.
		dbg("reading chrome stdin");
		let stdinBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
		for await (const chunk of process.stdin) {
			const bytes = new Uint8Array(chunk);
			const next = new Uint8Array(stdinBuffer.length + bytes.length);
			next.set(stdinBuffer, 0);
			next.set(bytes, stdinBuffer.length);
			const { messages, rest } = decodeNm(next);
			stdinBuffer = rest;
			for (const msg of messages) {
				dbg(`chrome→socket ${JSON.stringify(msg).length}B`);
				socket.write(`${JSON.stringify(msg)}\n`);
			}
		}

		// Chrome closed stdin — tear down and exit.
		dbg("chrome stdin EOF → exit");
		socket.end();
		process.exit(0);
	}

	/**
	 * Connect to the manager, spawning a detached one if the first connect fails.
	 * Idempotent: a successful first connect spawns nothing (never two managers).
	 * Returns the connected socket, or undefined if unreachable after backoff.
	 */
	private async ensureManager(socket: Parameters<typeof Bun.connect>[0]["socket"]): Promise<Sock | undefined> {
		// Version-aware supersede (#1874): if a manager already owns the socket, read
		// its version. If THIS binary is newer (e.g. a `brew upgrade` happened but the
		// old detached manager is still running), ask it to step down and take over —
		// otherwise the extension stays pinned to the stale version forever. Same-or-
		// newer running version → just use it (never downgrade).
		const runningVersion = await this.#managerVersion();
		if (runningVersion !== null && !shouldSupersede(runningVersion, VERSION)) {
			dbg(`manager live @ ${runningVersion} (ours ${VERSION}) — connecting`);
			try {
				return await Bun.connect({ unix: SOCKET_PATH, socket });
			} catch {
				dbg("live manager raced away before relay connect → spawn");
			}
		} else if (runningVersion !== null) {
			dbg(`supersede: running ${runningVersion} < ours ${VERSION} → step down`);
			await this.#stepDownRunningManager();
		} else {
			dbg("no manager reachable → spawn");
		}

		// Spawn the manager DETACHED and long-lived. It is NOT awaited/retained so
		// it outlives this host process; on macOS killing the host does not kill it.
		Bun.spawn([process.execPath, ...reexecArgv("manager")], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});

		// Retry-connect with a short backoff while the manager binds its socket.
		for (let i = 0; i < CONNECT_RETRIES; i++) {
			await Bun.sleep(CONNECT_BACKOFF_MS);
			try {
				const s = await Bun.connect({ unix: SOCKET_PATH, socket });
				dbg(`connect: succeeded after ${i + 1} retries`);
				return s;
			} catch {
				/* manager not bound yet — keep retrying */
			}
		}
		return undefined;
	}

	/** The running manager's advertised version via the `hello` handshake, or null
	 * if none is reachable. Uses a throwaway connection (separate from the relay). */
	async #managerVersion(timeoutMs = 1500): Promise<string | null> {
		const ack = await this.#managerRequest({ type: "hello" }, timeoutMs);
		return typeof ack?.version === "string" ? ack.version : null;
	}

	/** Send one control frame and resolve the manager's first reply line (or null). */
	#managerRequest(frame: unknown, timeoutMs: number): Promise<Record<string, unknown> | null> {
		return new Promise(resolve => {
			let buf = "";
			let done = false;
			const finish = (v: Record<string, unknown> | null) => {
				if (done) return;
				done = true;
				resolve(v);
			};
			Bun.connect({
				unix: SOCKET_PATH,
				socket: {
					open(c) {
						c.write(`${JSON.stringify(frame)}\n`);
					},
					data(c, d) {
						buf += d.toString("utf8");
						const nl = buf.indexOf("\n");
						if (nl < 0) return;
						try {
							finish(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
						} catch {
							finish(null);
						}
						try {
							c.end();
						} catch {
							/* already closing */
						}
					},
					error() {
						finish(null);
					},
				},
			}).catch(() => finish(null));
			setTimeout(() => finish(null), timeoutMs);
		});
	}

	/** True if anything is accepting the control socket right now. */
	async #managerReachable(): Promise<boolean> {
		try {
			const c = await Bun.connect({ unix: SOCKET_PATH, socket: { data() {} } });
			c.end();
			return true;
		} catch {
			return false;
		}
	}

	/** Ask the running manager to step down, then wait (bounded) for the socket to
	 * free — escalating to SIGTERM on the recorded pid if it won't release. */
	async #stepDownRunningManager(timeoutMs = 5000): Promise<void> {
		try {
			const c = await Bun.connect({ unix: SOCKET_PATH, socket: { data() {} } });
			c.write(`${JSON.stringify({ type: "shutdown", reason: "superseded" })}\n`);
			await Bun.sleep(50);
			c.end();
		} catch {
			/* already gone */
		}
		const deadline = Date.now() + timeoutMs;
		let escalated = false;
		while (Date.now() < deadline) {
			if (!(await this.#managerReachable())) return; // socket freed → success
			if (!escalated && Date.now() > deadline - timeoutMs / 2) {
				const st = readManagerState(SOCKET_PATH); // won't drain gracefully → SIGTERM the pid
				if (st?.pid) {
					try {
						process.kill(st.pid);
					} catch {
						/* already gone */
					}
				}
				escalated = true;
			}
			await Bun.sleep(100);
		}
	}
}
