/**
 * Manager mode — `xcsh manager`.
 *
 * A detached, long-lived control server that owns the fleet of per-tab
 * `xcsh worker` processes. It listens on a UNIX SOCKET (`~/.xcsh/manager.sock`,
 * override `XCSH_MANAGER_SOCK`) for NDJSON control frames — one JSON object per
 * line — validated by the pure `manager-core` protocol:
 *
 *   {"type":"provision","sessionId":"tab-7","tenant":"example-corp|staging"}
 *        → spawn a worker for that sessionId (idempotent). The registry is keyed
 *          on sessionId, so two tabs of the SAME tenant get two workers.
 *   {"type":"release","sessionId":"tab-7"}  → kill + forget that session's worker
 *   {"type":"status"}                        → accepted; no-op sink
 *   {"type":"status","sessionId":"tab-7"}    → keepalive: refresh that worker's
 *          lastSeen so an actively-chatting session is not idle-reaped
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
import { EXTENSION_ID } from "../browser/extension-identity";
// Lean standalone fn (compiled-runtime detection) — no heavy graph, safe for the daemon.
import { detectCompiledRuntime } from "../internal-urls/build-info-runtime";
import { removeManagerState, writeManagerState } from "../services/manager-state";
import {
	binaryIsStale,
	needsProvision,
	parseControlMsg,
	type Registry,
	selectSpawnPort,
	sparesToSpawn,
	staleKeys,
	touchLastSeen,
} from "./manager-core";

/** Reap a worker idle longer than this (ms). */
const IDLE_MS = 20 * 60_000;
/** How often the idle sweep runs (ms). */
const SWEEP_MS = 60_000;

/**
 * Whether a loopback TCP port is bindable RIGHT NOW. A range port can be held by
 * another app, a stale worker, or a second manager, and a spawned worker binds its
 * forced `XCSH_BRIDGE_PORT` strictly — it throws and exits rather than falling back
 * — so an occupied port must be ruled out before we hand it over.
 *
 * NOTE this is a BINDING probe, not a read: it takes the port and releases it. Only
 * `selectSpawnPort` may call it, and only for ports we have not already handed out;
 * probing one of our own in-flight workers can win the bind and kill it (#2463).
 * Bun.listen binds and throws synchronously, so this stays sync — keeping provision
 * idempotency race-free.
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

/** The PID listening on a loopback bridge port, or 0 if unknown (best-effort via
 * lsof). Used only to give a re-adopted worker a reapable pid; 0 means "manage by
 * socket liveness, never signal" (see killPid's pid<=0 guard). */
function pidListeningOn(port: number): number {
	try {
		const out = Bun.spawnSync(["lsof", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"])
			.stdout.toString()
			.trim()
			.split("\n")[0];
		const pid = Number(out);
		return Number.isInteger(pid) && pid > 0 ? pid : 0;
	} catch {
		return 0; // lsof unavailable — leave unknown
	}
}

/** Complete the extension `hello` handshake against a bridge port (with the
 * origin header the bridge requires), resolving the `hello_ack` frame or null. */
function bridgeHello(port: number, timeoutMs = 400): Promise<Record<string, unknown> | null> {
	const { promise, resolve } = Promise.withResolvers<Record<string, unknown> | null>();
	let done = false;
	const finish = (value: Record<string, unknown> | null) => {
		if (done) return;
		done = true;
		resolve(value);
	};
	let ws: WebSocket;
	try {
		// Intentionally ws://: the internal Chrome re-adoption client targets the
		// bridge's local ws listener and does not cross the Office TLS boundary.
		ws = new WebSocket(`ws://127.0.0.1:${port}`, {
			headers: { Origin: `chrome-extension://${EXTENSION_ID}` },
		} as unknown as string[]);
	} catch {
		finish(null);
		return promise;
	}
	const close = () => {
		try {
			ws.close();
		} catch {
			/* already closing */
		}
	};
	ws.onopen = () => ws.send(JSON.stringify({ type: "hello" }));
	ws.onmessage = event => {
		try {
			finish(JSON.parse(String(event.data)) as Record<string, unknown>);
		} catch {
			finish(null);
		}
		close();
	};
	ws.onerror = () => finish(null);
	void Bun.sleep(timeoutMs).then(() => {
		close();
		finish(null);
	});
	return promise;
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

		// Durable-upgrade self-recycle (#upgrade-recycle): a compiled manager whose
		// on-disk binary was removed by `brew upgrade`+`brew cleanup` lingers on the
		// freed inode but can no longer spawn workers (ENOENT) → it must step down so a
		// fresh manager (from the version-stable PATH wrapper) takes over. Dev is never
		// compiled → never stale. `XCSH_FORCE_STALE=1` lets the dev-mode integration test
		// exercise the recycle path (same env-override convention as XCSH_MANAGER_VERSION).
		const compiled = detectCompiledRuntime(import.meta.url, Bun.env);
		const isSelfStale = (): boolean =>
			process.env.XCSH_FORCE_STALE === "1" ||
			binaryIsStale({ compiled, execPath: process.execPath, exists: fs.existsSync });

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
			// Same rule as spawnWorker: assigned and reserved ports are never probed.
			const port = selectSpawnPort(
				reg,
				range,
				pool.map(s => s.port),
				isPortFree,
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

		/** Zero-downtime handoff (#1874 Task 6): on startup, discover bridge workers a
		 * PRIOR (superseded) manager left running and re-register them, so a tab's
		 * session survives the manager swap. Probes the whole range in parallel; a
		 * bridge answering with a real per-tab sessionId (not the "spare" sentinel) and
		 * a tenant+env is re-adopted. Spares/unknowns are ignored (the pool refills
		 * them). Best-effort — never throws. */
		const readoptWorkers = async (): Promise<void> => {
			const found = await Promise.all(range.map(async port => ({ port, ack: await bridgeHello(port) })));
			for (const { port, ack } of found) {
				if (!ack) continue;
				const sid = ack.sessionId;
				const tenant = ack.tenant;
				const env = ack.env;
				if (typeof sid !== "string" || sid === "spare" || typeof tenant !== "string" || typeof env !== "string") {
					continue; // spare sentinel or tenant-less bridge — not a re-adoptable session
				}
				if (reg.has(sid)) continue;
				reg.set(sid, {
					sessionId: sid,
					tenant: `${tenant}|${env}`,
					port,
					pid: pidListeningOn(port),
					lastSeen: Date.now(),
				});
				console.error(`[xcsh manager] re-adopted worker ${sid} (${tenant}|${env}) on port ${port}`);
			}
		};

		/** Adopt a warm spare for a provision (bind over IPC). Returns false if none available. */
		const adoptSpare = (msg: { sessionId: string; tenant: string }, managerProvisionMs: number): boolean => {
			const rec = pool.shift();
			if (!rec) return false;
			// `send` exists because the spare was spawned with an `ipc` handler.
			(rec.proc as { send(m: unknown): void }).send({
				type: "bind",
				sessionId: msg.sessionId,
				tenant: msg.tenant,
				provisionMs: managerProvisionMs, // TTFT Phase 2: relayed manager_provision (warm)
				cold: false, // authoritative: warm adopt
			});
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

		const killPid = (pid: number): void => {
			if (pid <= 0) return; // 0/negative = unknown (re-adopted worker) — NEVER signal (kill(0) hits the group)
			try {
				process.kill(pid); // SIGTERM — spares exit at once; bound workers self-drain (worker.ts)
			} catch {
				/* already gone */
			}
		};

		const reap = (sessionId: string): void => {
			const w = reg.get(sessionId);
			if (!w) return;
			killPid(w.pid);
			reg.delete(sessionId);
		};

		/** Graceful teardown (#1874): stop accepting, terminate the (session-less)
		 * spare pool at once, drop the socket + liveness record, and exit. Idempotent.
		 *
		 * Bound workers depend on the reason: on a HANDOFF (superseded/updated — a
		 * successor manager is about to bind and re-adopt them), we LEAVE them running
		 * so tab sessions survive the swap (zero-downtime, Task 6). Otherwise (manual
		 * operator SIGTERM — no successor) we SIGTERM them so they drain + exit rather
		 * than leak. The manager frees the socket immediately either way. */
		const gracefulShutdown = (reason: string): void => {
			if (shuttingDown) return;
			shuttingDown = true;
			accepting = false;
			const handoff = reason === "superseded" || reason === "updated";
			console.error(
				`[xcsh manager] graceful shutdown (${reason}); reaping ${pool.length} spare(s)` +
					(handoff ? `, leaving ${reg.size} worker(s) for re-adoption` : ` + ${reg.size} worker(s)`),
			);
			for (const s of pool.splice(0)) killPid(s.pid);
			if (!handoff) {
				for (const w of reg.values()) killPid(w.pid);
				reg.clear();
			}
			removeManagerState(sockPath);
			try {
				fs.rmSync(sockPath, { force: true });
			} catch {
				/* best effort — the OS drops the bound socket on exit anyway */
			}
			process.exit(0);
		};

		const spawnWorker = (msg: { sessionId: string; tenant: string }, managerProvisionMs: number): void => {
			// Never probe a port we have already handed out: isPortFree BINDS to find
			// out, so sweeping the whole range could win the bind from a worker that is
			// still starting up and kill it (#2463). Spares are reserved the same way.
			const port = selectSpawnPort(
				reg,
				range,
				pool.map(s => s.port),
				isPortFree,
			);
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
					// TTFT Phase 2: relay cold-start timing to the worker (only it has a WS to
					// the extension). Wall-clock spawn instant + manager_provision ms; COLD=1
					// marks the authoritative cold spawn.
					XCSH_TTFT_SPAWN_AT: String(Date.now()),
					XCSH_TTFT_PROVISION_MS: String(managerProvisionMs),
					XCSH_TTFT_COLD: "1",
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
				// Draining, OR self-stale (our binary was removed by an upgrade): refuse
				// this provision so the host retries the successor manager — spawning now
				// would ENOENT on the deleted binary. If stale-but-still-accepting, step
				// down immediately so the fresh manager takes over in seconds (not on the
				// ≤60s sweep). Reuses the existing draining reply/contract.
				const stale = accepting && isSelfStale();
				if (!accepting || stale) {
					try {
						socket.write(`${JSON.stringify({ type: "draining" })}\n`);
					} catch {
						/* client hung up */
					}
					if (stale) {
						console.error("[xcsh manager] binary is stale (upgraded/removed) — recycling on provision");
						gracefulShutdown("updated");
					}
					return;
				}
				const provisionReceivedAt = Date.now(); // TTFT Phase 2: start of manager_provision
				if (needsProvision(reg, msg.sessionId)) {
					const managerProvisionMs = Date.now() - provisionReceivedAt;
					if (!adoptSpare(msg, managerProvisionMs)) spawnWorker(msg, managerProvisionMs); // adopt a warm spare, else cold-spawn (fallback)
				}
				touchLastSeen(reg, msg.sessionId, Date.now()); // touch on every provision (keep-alive)
			} else if (msg.type === "status") {
				// Keepalive from an actively-chatting worker (#idle-reap): refresh
				// lastSeen so the idle sweep never reaps a session that is in use.
				// Chat traffic never reaches the manager, so this is the only signal
				// that an otherwise-quiet-to-the-manager worker is still working.
				touchLastSeen(reg, msg.sessionId, Date.now());
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

		// Finish startup reconciliation before publishing the control socket. A socket
		// that accepts connections is the manager's readiness contract: clients send
		// their first frame immediately, and a request/reply client can otherwise time
		// out while the initial bridge scan is still loading and probing dependencies.
		await readoptWorkers();

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

		// Idle sweep: reap workers untouched for longer than the TTL. Also self-recycle
		// if our own binary went stale (upgrade removed it) — a lingering deleted-binary
		// manager can't spawn workers, so step down for a fresh one (#upgrade-recycle).
		setInterval(() => {
			if (isSelfStale()) {
				console.error("[xcsh manager] binary is stale (upgraded/removed) — recycling on sweep");
				gracefulShutdown("updated");
				return;
			}
			for (const key of staleKeys(reg, Date.now(), IDLE_MS)) reap(key);
		}, SWEEP_MS);

		// Detached, long-lived: block until the process is torn down.
		await new Promise<never>(() => {});
	}
}
