/**
 * Manager mode — `xcsh manager`.
 *
 * A detached, long-lived control server that owns the fleet of per-tenant
 * `xcsh worker` processes. It listens on a UNIX SOCKET (`~/.xcsh/manager.sock`,
 * override `XCSH_MANAGER_SOCK`) for NDJSON control frames — one JSON object per
 * line — validated by the pure `manager-core` protocol:
 *
 *   {"type":"provision","tenantKey":"acme|staging"}  → spawn a worker (idempotent)
 *   {"type":"release","tenantKey":"acme|staging"}     → kill + forget the worker
 *   {"type":"status"}                                 → accepted; no-op sink
 *
 * All registry/port/idempotency/idle policy is the pure `manager-core`; this file
 * is the thin I/O shell (socket, spawn, kill, timer) around it. A background sweep
 * reaps workers idle longer than the TTL. The process blocks forever.
 */
import * as fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { portCandidates } from "../browser/extension-bridge";
import { needsProvision, parseControlMsg, pickPort, type Registry, staleKeys } from "./manager-core";

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

export default class Manager extends Command {
	static description = "Run the detached control server that spawns/reaps per-tenant workers; blocks forever";

	async run(): Promise<void> {
		const sockPath = process.env.XCSH_MANAGER_SOCK ?? join(homedir(), ".xcsh", "manager.sock");
		fs.mkdirSync(dirname(sockPath), { recursive: true });
		// Recreate the socket: a stale file from a crashed manager would make bind fail.
		try {
			fs.rmSync(sockPath, { force: true });
		} catch {
			/* nothing to remove */
		}

		const reg: Registry = new Map();
		const range = portCandidates();

		const reap = (tenantKey: string): void => {
			const w = reg.get(tenantKey);
			if (!w) return;
			try {
				process.kill(w.pid);
			} catch {
				/* already gone */
			}
			reg.delete(tenantKey);
		};

		const spawnWorker = (tenantKey: string): void => {
			// Registry-dedupe (pickPort) over only the ports free at the OS level.
			const port = pickPort(reg, range.filter(isPortFree));
			if (port === null) {
				console.error(`[xcsh manager] port range exhausted; cannot provision ${tenantKey}`);
				return;
			}
			const proc = Bun.spawn([process.execPath, ...workerArgv()], {
				env: {
					...process.env,
					XCSH_BROWSER_PROVIDER: "extension",
					XCSH_SESSION_TENANT: tenantKey,
					XCSH_BRIDGE_PORT: String(port),
				},
				stdout: "ignore",
				stderr: "ignore",
			});
			reg.set(tenantKey, { tenantKey, port, pid: proc.pid, lastSeen: Date.now() });
			// Reconcile a dead worker: when THIS process exits (crash, forced-port
			// EADDRINUSE with no retry, etc.), drop its registry entry so the next
			// provision respawns instead of finding a zombie. Guard on pid so an
			// already-respawned entry for the same tenant is never clobbered.
			proc.exited.then(() => {
				const cur = reg.get(tenantKey);
				if (cur && cur.pid === proc.pid) reg.delete(tenantKey);
			});
			console.error(`[xcsh manager] provisioned ${tenantKey} → pid ${proc.pid} on port ${port}`);
		};

		const handleFrame = (line: string): void => {
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
				if (needsProvision(reg, msg.tenantKey)) spawnWorker(msg.tenantKey);
				const w = reg.get(msg.tenantKey);
				if (w) w.lastSeen = Date.now(); // touch on every provision (keep-alive)
			} else if (msg.type === "release") {
				reap(msg.tenantKey);
			}
			// "status" is validated but currently a no-op sink.
		};

		// Per-connection NDJSON buffer: a control frame can be split across two TCP
		// reads, so we only parse complete newline-terminated lines and retain any
		// trailing fragment until the rest of it arrives. Keyed by socket (WeakMap
		// so a closed connection's buffer is collected without manual bookkeeping).
		const buffers = new WeakMap<object, string>();
		Bun.listen({
			unix: sockPath,
			socket: {
				data(socket, data): void {
					const combined = (buffers.get(socket) ?? "") + data.toString("utf8");
					const parts = combined.split("\n");
					buffers.set(socket, parts.pop() ?? ""); // keep the incomplete trailing fragment
					for (const line of parts) handleFrame(line);
				},
				close(socket): void {
					buffers.delete(socket);
				},
			},
		});
		console.error(`[xcsh manager] control socket listening at ${sockPath}`);

		// Idle sweep: reap workers untouched for longer than the TTL.
		setInterval(() => {
			for (const key of staleKeys(reg, Date.now(), IDLE_MS)) reap(key);
		}, SWEEP_MS);

		// Detached, long-lived: block until the process is torn down.
		await new Promise<never>(() => {});
	}
}
