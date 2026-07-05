/**
 * Manager mode — `xcsh manager`.
 *
 * A detached, long-lived control server that owns the fleet of per-tab
 * `xcsh worker` processes. It listens on a UNIX SOCKET (`~/.xcsh/manager.sock`,
 * override `XCSH_MANAGER_SOCK`) for NDJSON control frames — one JSON object per
 * line — validated by the pure `manager-core` protocol:
 *
 *   {"type":"provision","sessionId":"tab-7","tenant":"acme|staging"}
 *        → spawn a worker for that sessionId (idempotent). The registry is keyed
 *          on sessionId, so two tabs of the SAME tenant get two workers.
 *   {"type":"release","sessionId":"tab-7"}  → kill + forget that session's worker
 *   {"type":"status"}                        → accepted; no-op sink
 *
 * All registry/port/idempotency/idle policy is the pure `manager-core`; this file
 * is the thin I/O shell (socket, spawn, kill, timer) around it. A background sweep
 * reaps workers idle longer than the TTL. The process blocks forever.
 */
import * as fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "@f5-sales-demo/pi-utils/cli";
// Lean subpath (not the package barrel, which pulls the winston logger graph and
// slows the manager's cold start — keep the daemon's module graph minimal).
import { VERSION } from "@f5-sales-demo/pi-utils/dirs";
import { portCandidates } from "../browser/extension-bridge";
import { removeManagerState, writeManagerState } from "../services/manager-state";
import { needsProvision, parseControlMsg, pickPort, type Registry, sparesToSpawn, staleKeys } from "./manager-core";

/** Reap a worker idle longer than this (ms). */
const IDLE_MS = 20 * 60_000;
/** How often the idle sweep runs (ms). */
const SWEEP_MS = 60_000;

/**
 * Whether a loopback TCP port is bindable RIGHT NOW. `pickPort` only dedupes
 * against the manager's own registry; a range port can still be held by another
 * app, a stale worker, or a second manager. We pre-filter the range with this so
 * a spawned worker (which binds its forced `XCSH_BRIDGE_PORT` strictly) never
 * lands on an occupied port and dies. Bun.listen binds and throws synchronously,
 * so this stays sync — keeping provision idempotency race-free.
 */
function isPortFree(port: number): boolean {
	try {
		const listener = Bun.listen({
			hostname: "127.0.0.1",
			port,
			socket: { data() {}, open() {}, close() {}, error() {} },
		});
		listener.stop(true);
		return true;
	} catch {
		return false;
	}
}

/**
 * The argv (AFTER `process.execPath`) to re-run THIS binary in `mode`.
 *
 * Dev: launched as `bun /abs/src/cli.ts manager`, so `process.argv[1]` is the
 * script path → `["/abs/src/cli.ts", <mode>]`, and `process.execPath` is bun.
 *
 * Compiled: `process.execPath` IS the xcsh binary and `process.argv[1]` is the
 * subcommand (e.g. "manager"), not a script file → `[<mode>]`.
 *
 * We detect dev by the script extension so the integration tests — which run
 * `bun src/cli.ts <mode>` — re-exec a genuinely working subcommand. Shared by
 * the manager (worker re-exec) and the chrome-host (manager re-exec).
 */
export function reexecArgv(mode: "worker" | "manager"): string[] {
	const script = process.argv[1];
	if (script && (script.endsWith(".ts") || script.endsWith(".js") || script.endsWith(".mjs"))) {
		return [script, mode];
	}
	return [mode];
}

/** The argv (AFTER `process.execPath`) to re-run THIS binary in `worker` mode. */
export function workerArgv(): string[] {
	return reexecArgv("worker");
}

/**
 * Acquire the manager control socket, robust across Bun runtimes.
 *
 * The single-manager invariant needs three things at once: (1) never clobber a
 * LIVE manager's socket, (2) reclaim a STALE socket left by a crashed/killed
 * manager, and (3) survive a concurrent cold-start race. Bun's unix `listen` is
 * NOT a reliable oracle here — dev `bun run` silently unlinks-and-rebinds a
 * stale socket, while the COMPILED binary throws EADDRINUSE (xcsh #1846), which
 * previously crashed the manager and silently killed all automation. So we drive
 * it explicitly:
 *
 *   1. Probe for a live owner. If one answers → we lost; bail ("already-live").
 *   2. Try to listen. If it binds → done ("bound").
 *   3. On EADDRINUSE, RE-PROBE: a live answer now means a rival bound between
 *      our probe and our listen → bail WITHOUT touching its socket. Otherwise
 *      the file is confirmed stale → unlink it and retry listen once. A still-
 *      failing retry (or any non-EADDRINUSE error) propagates loudly.
 *
 * Effects are injected so the branch logic is unit-tested deterministically
 * (the compiled-only EADDRINUSE path is unreachable from a dev test otherwise).
 */
export async function acquireControlSocket(opts: {
	sockPath: string;
	probeLive: (sockPath: string) => Promise<boolean>;
	listen: () => void;
	unlink: (sockPath: string) => void;
	isAddrInUse: (err: unknown) => boolean;
}): Promise<"bound" | "already-live"> {
	const { sockPath, probeLive, listen, unlink, isAddrInUse } = opts;
	if (await probeLive(sockPath)) return "already-live";
	try {
		listen();
		return "bound";
	} catch (err) {
		if (!isAddrInUse(err)) throw err;
		// Bind collided. Distinguish a live rival (lost a cold-start race) from a
		// stale file left by a crashed manager.
		if (await probeLive(sockPath)) return "already-live";
		unlink(sockPath); // confirmed stale → reclaim it
		listen(); // retry once; a real failure now propagates
		return "bound";
	}
}

export default class Manager extends Command {
	static description = "Run the detached control server that spawns/reaps per-tab workers; blocks forever";

	async run(): Promise<void> {
		const sockPath = process.env.XCSH_MANAGER_SOCK ?? join(homedir(), ".xcsh", "manager.sock");
		fs.mkdirSync(dirname(sockPath), { recursive: true });

		const reg: Registry = new Map();
		const range = portCandidates();

		// The version this manager advertises (hello ack + manager.json). Overridable
		// via env ONLY so the supersede integration tests can stand up an "old" manager
		// (production always reports the real binary VERSION).
		const selfVersion = process.env.XCSH_MANAGER_VERSION || VERSION;

		// Lifecycle gate (#1874): once we begin graceful shutdown we stop accepting
		// provisions (the host retries the successor manager) and never double-run
		// the teardown.
		let accepting = true;
		let shuttingDown = false;

		const poolTarget = Math.max(0, Math.trunc(Number(process.env.XCSH_WORKER_POOL_SIZE ?? "2")) || 0);
		interface SpareRec {
			proc: Bun.Subprocess;
			port: number;
			pid: number;
		}
		const pool: SpareRec[] = [];

		const spawnSpare = (): void => {
			const usedPorts = new Set<number>([...reg.values()].map(w => w.port).concat(pool.map(s => s.port)));
			const port = pickPort(
				reg,
				range.filter(p => !usedPorts.has(p) && isPortFree(p)),
			);
			if (port === null) return; // range full — do not pre-warm
			const proc = Bun.spawn([process.execPath, ...workerArgv()], {
				env: {
					...process.env,
					XCSH_BROWSER_PROVIDER: "extension",
					XCSH_BRIDGE_PORT: String(port),
					// Identity-less spare: NO XCSH_SESSION_ID / XCSH_SESSION_TENANT (bound later via IPC).
					// The spare marker makes sdk.ts skip its create-time context bootstrap, so the
					// spare never boot-activates a tenant's context/credentials before its IPC bind
					// (see shouldRunSessionContextBootstrap). Explicitly clear session identity too so
					// the spare can never inherit an ambient session from the manager's env.
					XCSH_WORKER_SPARE: "1",
					XCSH_SESSION_ID: undefined,
					XCSH_SESSION_TENANT: undefined,
					XCSH_API_URL: undefined,
					XCSH_API_TOKEN: undefined,
				},
				ipc() {}, // enable Bun parent→child IPC; no worker→manager messages needed today
				stdout: "ignore",
				stderr: "ignore",
			});
			const rec: SpareRec = { proc, port, pid: proc.pid };
			pool.push(rec);
			proc.exited.then(() => {
				const i = pool.indexOf(rec);
				if (i >= 0) pool.splice(i, 1); // a live spare died → drop + replenish
				maintainPool();
			});
			console.error(`[xcsh manager] pre-warmed spare → pid ${proc.pid} on port ${port}`);
		};

		const maintainPool = (): void => {
			const n = sparesToSpawn(poolTarget, pool.length, reg.size, range.length);
			for (let i = 0; i < n; i++) spawnSpare();
		};

		/** Adopt a warm spare for a provision (bind over IPC). Returns false if none available. */
		const adoptSpare = (msg: { sessionId: string; tenant: string }): boolean => {
			const rec = pool.shift();
			if (!rec) return false;
			// `send` exists because the spare was spawned with an `ipc` handler.
			(rec.proc as { send(m: unknown): void }).send({ type: "bind", sessionId: msg.sessionId, tenant: msg.tenant });
			reg.set(msg.sessionId, {
				sessionId: msg.sessionId,
				tenant: msg.tenant,
				port: rec.port,
				pid: rec.pid,
				lastSeen: Date.now(),
			});
			rec.proc.exited.then(() => {
				const cur = reg.get(msg.sessionId);
				if (cur && cur.pid === rec.pid) reg.delete(msg.sessionId);
			});
			maintainPool(); // replenish the consumed spare
			console.error(
				`[xcsh manager] adopted spare pid ${rec.pid} on port ${rec.port} as ${msg.sessionId} (${msg.tenant})`,
			);
			return true;
		};

		const reap = (sessionId: string): void => {
			const w = reg.get(sessionId);
			if (!w) return;
			try {
				process.kill(w.pid);
			} catch {
				/* already gone */
			}
			reg.delete(sessionId);
		};

		const killPid = (pid: number): void => {
			try {
				process.kill(pid); // SIGTERM — spares exit at once; bound workers self-drain (worker.ts)
			} catch {
				/* already gone */
			}
		};

		/** Graceful teardown (#1874): stop accepting, terminate the (session-less)
		 * spare pool at once, SIGTERM bound workers so they drain their in-flight turn,
		 * drop the socket + liveness record, and exit. Idempotent. Bounded by each
		 * worker's own drain ceiling — the manager frees the socket immediately so a
		 * successor can bind without waiting on drains. */
		const gracefulShutdown = (reason: string): void => {
			if (shuttingDown) return;
			shuttingDown = true;
			accepting = false;
			console.error(
				`[xcsh manager] graceful shutdown (${reason}); reaping ${pool.length} spare(s) + ${reg.size} worker(s)`,
			);
			for (const s of pool.splice(0)) killPid(s.pid);
			for (const w of reg.values()) killPid(w.pid);
			reg.clear();
			removeManagerState(sockPath);
			try {
				fs.rmSync(sockPath, { force: true });
			} catch {
				/* best effort — the OS drops the bound socket on exit anyway */
			}
			process.exit(0);
		};

		const spawnWorker = (msg: { sessionId: string; tenant: string }): void => {
			// Registry-dedupe (pickPort) over only the ports free at the OS level.
			const port = pickPort(reg, range.filter(isPortFree));
			if (port === null) {
				console.error(`[xcsh manager] port range exhausted; cannot provision ${msg.sessionId}`);
				return;
			}
			const proc = Bun.spawn([process.execPath, ...workerArgv()], {
				env: {
					...process.env,
					XCSH_BROWSER_PROVIDER: "extension",
					XCSH_SESSION_ID: msg.sessionId,
					XCSH_SESSION_TENANT: msg.tenant,
					XCSH_BRIDGE_PORT: String(port),
					// Isolate the worker's tenant binding: an ambient XCSH_API_URL in the
					// manager's env would make sdk.ts skip the XCSH_SESSION_TENANT branch and
					// bind hello_ack.tenant from the env apiUrl instead. Clear both so the
					// spawned tenant key is authoritative (undefined removes the var in Bun).
					XCSH_API_URL: undefined,
					XCSH_API_TOKEN: undefined,
				},
				stdout: "ignore",
				stderr: "ignore",
			});
			reg.set(msg.sessionId, {
				sessionId: msg.sessionId,
				tenant: msg.tenant,
				port,
				pid: proc.pid,
				lastSeen: Date.now(),
			});
			// Reconcile a dead worker: when THIS process exits (crash, forced-port
			// EADDRINUSE with no retry, etc.), drop its registry entry so the next
			// provision respawns instead of finding a zombie. Guard on pid so an
			// already-respawned entry for the same sessionId is never clobbered.
			proc.exited.then(() => {
				const cur = reg.get(msg.sessionId);
				if (cur && cur.pid === proc.pid) reg.delete(msg.sessionId);
			});
			console.error(`[xcsh manager] provisioned ${msg.sessionId} (${msg.tenant}) → pid ${proc.pid} on port ${port}`);
		};

		const handleFrame = (line: string, socket: { write(data: string): void }): void => {
			const trimmed = line.trim();
			if (!trimmed) return;
			let raw: unknown;
			try {
				raw = JSON.parse(trimmed);
			} catch {
				return; // malformed line — ignore, keep serving
			}
			const msg = parseControlMsg(raw);
			if (!msg) return; // fail closed on unknown/invalid frames
			if (msg.type === "provision") {
				// Draining: refuse new work so the host retries the successor manager.
				if (!accepting) {
					try {
						socket.write(`${JSON.stringify({ type: "draining" })}\n`);
					} catch {
						/* client hung up */
					}
					return;
				}
				if (needsProvision(reg, msg.sessionId)) {
					if (!adoptSpare(msg)) spawnWorker(msg); // adopt a warm spare, else cold-spawn (fallback)
				}
				const w = reg.get(msg.sessionId);
				if (w) w.lastSeen = Date.now(); // touch on every provision (keep-alive)
			} else if (msg.type === "release") {
				reap(msg.sessionId);
			} else if (msg.type === "shutdown") {
				// A newer native-host (supersede) or the updater asks us to step down.
				gracefulShutdown(msg.reason);
			} else if (msg.type === "hello") {
				// Identity handshake (#1874): a newer native-host reads our version to
				// decide whether to supersede us. Answer over the same connection.
				try {
					socket.write(
						`${JSON.stringify({ type: "manager_hello_ack", version: selfVersion, pid: process.pid })}\n`,
					);
				} catch {
					/* client hung up mid-handshake — ignore */
				}
			}
			// "status" is validated but currently a no-op sink.
		};

		// Per-connection NDJSON buffer: a control frame can be split across two TCP
		// reads, so we only parse complete newline-terminated lines and retain any
		// trailing fragment until the rest of it arrives. Keyed by socket (WeakMap
		// so a closed connection's buffer is collected without manual bookkeeping).
		const buffers = new WeakMap<object, string>();
		const socketConfig = {
			unix: sockPath,
			socket: {
				data(socket: object, data: Buffer): void {
					const combined = (buffers.get(socket) ?? "") + data.toString("utf8");
					const parts = combined.split("\n");
					buffers.set(socket, parts.pop() ?? ""); // keep the incomplete trailing fragment
					for (const line of parts) handleFrame(line, socket as { write(data: string): void });
				},
				close(socket: object): void {
					buffers.delete(socket);
				},
			},
		};

		// Single-manager invariant + stale-socket reclamation. A live manager is
		// never clobbered (we probe first and again on collision); a stale socket
		// from a crashed/killed manager is reclaimed rather than crashing on
		// EADDRINUSE. See acquireControlSocket for the full rationale (xcsh #1846).
		const probeLive = async (p: string): Promise<boolean> => {
			try {
				const probe = await Promise.race([
					Bun.connect({ unix: p, socket: { data() {} } }),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error("manager liveness probe timeout")), 500),
					),
				]);
				probe.end();
				return true;
			} catch {
				return false; // nothing accepting → free path, or a stale socket file
			}
		};
		const outcome = await acquireControlSocket({
			sockPath,
			probeLive,
			listen: () => Bun.listen(socketConfig),
			unlink: p => fs.rmSync(p, { force: true }),
			isAddrInUse: err => (err as { code?: string } | null)?.code === "EADDRINUSE",
		});
		if (outcome === "already-live") {
			console.error(`[xcsh manager] another manager already live at ${sockPath}; exiting`);
			process.exit(0);
		}
		console.error(`[xcsh manager] control socket listening at ${sockPath}`);

		// Publish our liveness record (#1874) so a newer native-host can see which
		// version owns the socket (and, if it must supersede us, find our pid).
		writeManagerState(sockPath, { pid: process.pid, version: selfVersion, socket: sockPath, startedAt: Date.now() });

		// Clean-signal handling: an operator SIGTERM (or upgrade/recycle) tears us
		// down gracefully instead of orphaning workers + a stale socket/state file.
		process.on("SIGTERM", () => gracefulShutdown("manual"));
		process.on("SIGINT", () => gracefulShutdown("manual"));

		// Pre-warm the spare pool so provisions can adopt instead of cold-spawn.
		if (poolTarget > 0) maintainPool();

		// Idle sweep: reap workers untouched for longer than the TTL.
		setInterval(() => {
			for (const key of staleKeys(reg, Date.now(), IDLE_MS)) reap(key);
		}, SWEEP_MS);

		// Detached, long-lived: block until the process is torn down.
		await new Promise<never>(() => {});
	}
}
