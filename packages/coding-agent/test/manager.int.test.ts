/**
 * Integration test: `xcsh manager` control-socket server.
 *
 * Spawns a REAL manager subprocess (`bun src/cli.ts manager`) with a temp unix
 * control socket, sends a `provision` NDJSON frame over that socket, then proves
 * the manager spawned a REAL `xcsh worker` by probing the bridge port range for a
 * `hello_ack` advertising the provisioned tenant. Finally sends `release` and
 * proves the worker is reaped (the port goes silent).
 *
 * The worker's tenant advertisement flows: manager → XCSH_SESSION_TENANT env →
 * worker's contextless `sessionInfoForWorker()` → `hello_ack.tenant`.
 */
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VERSION } from "@f5-sales-demo/pi-utils";
import { probe } from "./helpers/bridge-probe";

let mgr: import("bun").Subprocess | undefined;
// A SECOND manager on the same socket (single-manager-invariant test). It is
// expected to detect the first and self-exit; tracked only so a regression that
// leaves it blocking forever is still reaped by afterEach.
let mgrB: import("bun").Subprocess | undefined;
let sock = "";

// Workers are separate processes the manager spawns; killing the manager does
// NOT reap them. Sweep the discovery range and kill any leftover worker so a
// failed/interrupted test can't leak a bound port into the next one. Never kill
// this test process itself (it holds outbound probe connections on these ports).
async function pidsOnPort(port: number): Promise<number[]> {
	try {
		const out = await new Response(Bun.spawn(["lsof", "-ti", `tcp:${port}`]).stdout).text();
		return out
			.trim()
			.split("\n")
			.map(s => Number(s.trim()))
			.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid);
	} catch {
		return []; // lsof unavailable — nothing we can enumerate
	}
}

afterEach(async () => {
	mgr?.kill();
	mgr = undefined;
	mgrB?.kill();
	mgrB = undefined;
	for (const p of RANGE) {
		for (const pid of await pidsOnPort(p)) {
			try {
				process.kill(pid);
			} catch {
				/* already gone */
			}
		}
	}
	if (sock) {
		try {
			fs.rmSync(sock, { force: true });
		} catch {
			/* best effort */
		}
	}
});

/** Send one NDJSON control frame over the manager's unix socket. */
async function send(msg: unknown): Promise<void> {
	const c = await Bun.connect({ unix: sock, socket: { data() {} } });
	c.write(`${JSON.stringify(msg)}\n`);
	await Bun.sleep(50);
	c.end();
}

/** Request/response over the control socket: send a frame, resolve the first
 * reply line (or null on timeout). Used for the `hello` identity handshake. */
async function request(msg: unknown, timeoutMs = 2000): Promise<Record<string, unknown> | null> {
	return await new Promise(resolve => {
		let buf = "";
		let done = false;
		const finish = (v: Record<string, unknown> | null) => {
			if (done) return;
			done = true;
			resolve(v);
		};
		Bun.connect({
			unix: sock,
			socket: {
				open(c) {
					c.write(`${JSON.stringify(msg)}\n`);
				},
				data(c, chunk) {
					buf += chunk.toString("utf8");
					const nl = buf.indexOf("\n");
					if (nl >= 0) {
						try {
							finish(JSON.parse(buf.slice(0, nl)));
						} catch {
							finish(null);
						}
						c.end();
					}
				},
			},
		}).catch(() => finish(null));
		setTimeout(() => finish(null), timeoutMs);
	});
}

/** Spawn a fresh manager on a temp socket and wait for it to bind. */
async function startManager(): Promise<void> {
	sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-")), "manager.sock");
	mgr = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		// Cold-spawn tests below assert on the 4-port RANGE; disable the pre-warm pool
		// so spares don't occupy those ports. Pool behavior is covered by its own tests.
		env: { ...process.env, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: "0" },
		stdout: "ignore",
		stderr: "ignore",
	});
	for (let i = 0; i < 60 && !fs.existsSync(sock); i++) await Bun.sleep(100);
	expect(fs.existsSync(sock)).toBe(true);
}

// Workers are assigned the LOWEST free range port (19222 up); the T4 worker test
// pins 19239, so polling the low end of the range avoids colliding with it.
const RANGE = [19222, 19223, 19224, 19225];

/** Poll the range for a hello_ack advertising `tenant`. */
async function findTenant(tenant: string, tries: number): Promise<number | null> {
	for (let i = 0; i < tries; i++) {
		for (const p of RANGE) {
			try {
				const ack = await probe(p);
				if (ack.tenant === tenant) return p;
			} catch {
				/* worker not up yet on this port */
			}
		}
		await Bun.sleep(250);
	}
	return null;
}

/**
 * Poll the range for a hello_ack advertising BOTH `tenant` AND `env`, returning
 * the full frame. #1872 guard: the extension's `liveTenants` filter keeps a
 * bridge only when both fields are set, so asserting `tenant` alone (findTenant)
 * would miss a regression that blanks `env` — the exact failure that shipped.
 */
async function findFrame(tenant: string, env: string, tries: number): Promise<Record<string, unknown> | null> {
	for (let i = 0; i < tries; i++) {
		for (const p of RANGE) {
			try {
				const ack = await probe(p);
				if (ack.tenant === tenant && ack.env === env) return ack;
			} catch {
				/* worker not up yet on this port */
			}
		}
		await Bun.sleep(250);
	}
	return null;
}

/**
 * Spawn a manager with a pre-warm pool size and capture its stderr live.
 *
 * The WS `hello_ack` "spare" probe used by worker-spawn.int.test.ts is
 * origin-checked and does not work in this sandbox, so we assert adoption via
 * the manager's OWN deterministic stderr logs instead:
 *   "pre-warmed spare"  → a spare was spawned (pool fill / replenish)
 *   "adopted spare"     → a provision adopted a warm spare (IPC bind)
 *   "provisioned"       → a provision cold-spawned (fallback path)
 */
async function startManagerWithPool(poolSize: string): Promise<() => string> {
	sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-")), "manager.sock");
	mgr = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		env: { ...process.env, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: poolSize },
		stdout: "ignore",
		stderr: "pipe",
	});
	let err = "";
	void (async () => {
		const reader = (mgr?.stderr as ReadableStream<Uint8Array>).getReader();
		const dec = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				err += dec.decode(value, { stream: true });
			}
		} catch {
			/* stream torn down when the manager is killed */
		}
	})();
	for (let i = 0; i < 60 && !fs.existsSync(sock); i++) await Bun.sleep(100);
	expect(fs.existsSync(sock)).toBe(true);
	return () => err;
}

/** Poll captured stderr until `sub` appears, or the try budget is spent. */
async function waitForStderr(getErr: () => string, sub: string, tries: number): Promise<boolean> {
	for (let i = 0; i < tries; i++) {
		if (getErr().includes(sub)) return true;
		await Bun.sleep(150);
	}
	return getErr().includes(sub);
}

/** Count non-overlapping occurrences of `sub` in `s`. */
function count(s: string, sub: string): number {
	let n = 0;
	let i = s.indexOf(sub);
	while (i >= 0) {
		n++;
		i = s.indexOf(sub, i + sub.length);
	}
	return n;
}

test("adopts a warm spare on provision, then replenishes the pool (XCSH_WORKER_POOL_SIZE=1)", async () => {
	const getErr = await startManagerWithPool("1");

	// Pool fills at startup: exactly one spare is pre-warmed.
	expect(await waitForStderr(getErr, "pre-warmed spare", 120)).toBe(true);

	await send({ type: "provision", sessionId: "tab-7", tenant: "acme|staging" });

	// The provision ADOPTS the warm spare (IPC bind), not a cold-spawn.
	expect(await waitForStderr(getErr, "adopted spare", 120)).toBe(true);
	// No cold-spawn fallback happened for this session.
	expect(getErr()).not.toContain("provisioned tab-7");
	// The consumed spare is replenished → a SECOND pre-warm appears.
	expect(await waitForStderr(getErr, "pre-warmed spare", 120)).toBe(true);
	expect(count(getErr(), "pre-warmed spare")).toBeGreaterThanOrEqual(2);

	await send({ type: "release", sessionId: "tab-7" });
}, 60_000);

test("adopted spare's hello_ack advertises BOTH tenant AND env (#1872 contract)", async () => {
	// The adoption path (#1862) late-binds via IPC and activates the tenant
	// context. Assert the ACTUAL frame — not just the "adopted spare" stderr — so a
	// regression that blanks `env` (e.g. an unparseable stored apiUrl overriding the
	// bound tenant key) is caught here instead of silently on the extension, which
	// filters any bridge missing tenant OR env and shows "No xcsh running".
	const getErr = await startManagerWithPool("1");
	expect(await waitForStderr(getErr, "pre-warmed spare", 120)).toBe(true);
	await send({ type: "provision", sessionId: "tab-7", tenant: "acme|staging" });
	expect(await waitForStderr(getErr, "adopted spare", 120)).toBe(true);
	const ack = await findFrame("acme", "staging", 80);
	expect(ack).not.toBeNull();
	expect(ack).toMatchObject({ tenant: "acme", env: "staging" });
	await send({ type: "release", sessionId: "tab-7" });
}, 60_000);

test("answers the hello handshake with its version + pid and publishes manager.json (#1874)", async () => {
	await startManager();

	const ack = await request({ type: "hello" });
	expect(ack).not.toBeNull();
	expect(ack).toMatchObject({ type: "manager_hello_ack", version: VERSION });
	expect(typeof ack?.pid).toBe("number");

	// Liveness record sits next to the socket and carries THIS manager's version.
	const statePath = path.join(path.dirname(sock), "manager.json");
	expect(fs.existsSync(statePath)).toBe(true);
	const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
	expect(state).toMatchObject({ version: VERSION, socket: sock, pid: ack?.pid });
	expect(typeof state.startedAt).toBe("number");
}, 30_000);

test("falls back to cold-spawn when the pool is disabled (XCSH_WORKER_POOL_SIZE=0)", async () => {
	const getErr = await startManagerWithPool("0");

	// A disabled pool never pre-warms a spare.
	await Bun.sleep(500);
	expect(getErr()).not.toContain("pre-warmed spare");

	await send({ type: "provision", sessionId: "tab-7", tenant: "acme|staging" });

	// With no spare to adopt, the provision cold-spawns (fallback path).
	expect(await waitForStderr(getErr, "provisioned tab-7", 120)).toBe(true);
	expect(getErr()).not.toContain("adopted spare");

	await send({ type: "release", sessionId: "tab-7" });
}, 60_000);

test("provision spawns a worker advertising the tenant; release reaps it", async () => {
	sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-")), "manager.sock");
	mgr = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		// Cold-spawn path under test — disable the pre-warm pool (own tests cover it).
		env: { ...process.env, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: "0" },
		stdout: "ignore",
		stderr: "ignore",
	});

	// Wait for the manager to bind its control socket.
	for (let i = 0; i < 60 && !fs.existsSync(sock); i++) await Bun.sleep(100);
	expect(fs.existsSync(sock)).toBe(true);

	await send({ type: "provision", sessionId: "tab-1", tenant: "acme|staging" });

	const port = await findTenant("acme", 80);
	expect(port).not.toBeNull();
	// #1872: the cold-spawn frame must carry env too (not just tenant).
	expect(await probe(port as number)).toMatchObject({ tenant: "acme", env: "staging" });

	// Release should reap the worker: the port stops answering the handshake.
	await send({ type: "release", sessionId: "tab-1" });
	let stillUp = true;
	for (let i = 0; i < 40; i++) {
		try {
			await probe(port as number);
		} catch {
			stillUp = false;
			break;
		}
		await Bun.sleep(250);
	}
	expect(stillUp).toBe(false);
}, 60_000);

test("provision spawns one worker PER sessionId (two same-tenant tabs → two workers)", async () => {
	await startManager();

	// Two tabs of the SAME tenant, keyed by distinct sessionIds. The manager keys
	// its registry on sessionId, not tenant, so each tab gets its OWN worker on its
	// own range port — even though both advertise the same tenant "acme".
	await send({ type: "provision", sessionId: "tab-101", tenant: "acme|staging" });
	await send({ type: "provision", sessionId: "tab-102", tenant: "acme|staging" });

	// Both workers should come up on distinct range ports, both advertising "acme".
	const ports = new Set<number>();
	await (async () => {
		for (let i = 0; i < 80 && ports.size < 2; i++) {
			for (const p of RANGE) {
				try {
					const a = await probe(p);
					if (a.tenant === "acme") ports.add(p);
				} catch {
					/* worker not up yet on this port */
				}
			}
			await Bun.sleep(250);
		}
	})();
	expect(ports.size).toBe(2);

	await send({ type: "release", sessionId: "tab-101" });
	await send({ type: "release", sessionId: "tab-102" });
}, 60_000);

test("an ambient XCSH_API_URL in the manager env does NOT leak into the worker's tenant binding", async () => {
	// The manager runs with an ambient XCSH_API_URL for a DIFFERENT tenant. The
	// worker reads process.env.XCSH_API_URL directly (sessionInfoForWorker), so if
	// the manager spread it into the worker's env the handshake would advertise
	// "leaktenant" (from the apiUrl), NOT the provisioned XCSH_SESSION_TENANT.
	// spawnWorker clears XCSH_API_URL/XCSH_API_TOKEN so the tenant key is authoritative.
	sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-")), "manager.sock");
	mgr = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			XCSH_MANAGER_SOCK: sock,
			// Assert spawnWorker's own env-clearing on the cold-spawn path — disable the pool.
			XCSH_WORKER_POOL_SIZE: "0",
			XCSH_API_URL: "https://leaktenant.console.ves.volterra.io",
			XCSH_API_TOKEN: "ambient-should-not-leak",
		},
		stdout: "ignore",
		stderr: "ignore",
	});
	for (let i = 0; i < 60 && !fs.existsSync(sock); i++) await Bun.sleep(100);
	expect(fs.existsSync(sock)).toBe(true);

	await send({ type: "provision", sessionId: "tab-iso", tenant: "isolate|staging" });

	// The worker must advertise the PROVISIONED tenant, not the ambient apiUrl's.
	const port = await findTenant("isolate", 80);
	expect(port).not.toBeNull();
	const leaked = await findTenant("leaktenant", 4);
	expect(leaked).toBeNull();

	await send({ type: "release", sessionId: "tab-iso" });
}, 60_000);

test("a provision frame split across two TCP writes is still parsed (NDJSON buffering)", async () => {
	await startManager();

	// Write ONE provision frame in two chunks split mid-JSON with a gap between,
	// so the manager's data handler sees the frame across two separate reads.
	// Without a per-connection buffer, neither half is valid JSON and the command
	// is silently dropped → no worker ever comes up.
	const frame = `${JSON.stringify({ type: "provision", sessionId: "tab-split", tenant: "split|staging" })}\n`;
	const cut = Math.floor(frame.length / 2);
	const c = await Bun.connect({ unix: sock, socket: { data() {} } });
	c.write(frame.slice(0, cut));
	await Bun.sleep(80);
	c.write(frame.slice(cut));
	await Bun.sleep(50);
	c.end();

	const port = await findTenant("split", 80);
	expect(port).not.toBeNull();

	await send({ type: "release", sessionId: "tab-split" });
}, 60_000);

test("a worker that dies out of band is reconciled so the next provision respawns", async () => {
	await startManager();

	await send({ type: "provision", sessionId: "tab-revive", tenant: "revive|staging" });
	const first = await findTenant("revive", 80);
	expect(first).not.toBeNull();

	// Kill the worker OUT OF BAND (not via release) by discovering its pid from
	// the bound port. The registry still holds a zombie entry until the manager's
	// exit handler reconciles it.
	const pids = await pidsOnPort(first as number);
	expect(pids.length).toBeGreaterThan(0); // lsof must resolve the worker pid on macOS
	for (const pid of pids) process.kill(pid);

	// Confirm the worker is actually dead (port goes silent) before re-provisioning;
	// this also guarantees the manager's `proc.exited` handler has run.
	let dead = false;
	for (let i = 0; i < 40; i++) {
		try {
			await probe(first as number);
		} catch {
			dead = true;
			break;
		}
		await Bun.sleep(250);
	}
	expect(dead).toBe(true);
	await Bun.sleep(250); // let the exit handler drop the zombie registry entry

	// Re-provision the SAME tenant. Only possible to come back up if needsProvision
	// flipped true — i.e. the dead worker was reconciled out of the registry.
	await send({ type: "provision", sessionId: "tab-revive", tenant: "revive|staging" });
	const second = await findTenant("revive", 80);
	expect(second).not.toBeNull();

	await send({ type: "release", sessionId: "tab-revive" });
}, 90_000);

test("a second manager on the same socket detects the live first and self-exits without orphaning it", async () => {
	// Manager A binds the socket and brings up a live worker.
	await startManager();
	await send({ type: "provision", sessionId: "tab-solo", tenant: "solo|a" });
	const portA = await findTenant("solo", 80);
	expect(portA).not.toBeNull();

	// Manager B cold-starts on the SAME socket. Its bind collides; it must probe,
	// discover A is live, and exit(0) WITHOUT unlinking A's socket. Under the old
	// rm-then-listen startup B would instead clobber A's socket and block forever
	// as a second live manager, orphaning A.
	mgrB = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		env: { ...process.env, XCSH_MANAGER_SOCK: sock },
		stdout: "ignore",
		stderr: "ignore",
	});

	// B must exit quickly (a live manager blocks forever). exitCode 0 = clean bail.
	const outcome = await Promise.race([
		mgrB.exited,
		new Promise<"blocked">(resolve => setTimeout(() => resolve("blocked"), 10_000)),
	]);
	expect(outcome).toBe(0);

	// A is UNHARMED: its socket still accepts control frames and still spawns
	// workers — provision a different tenant and confirm a new worker appears.
	await send({ type: "provision", sessionId: "tab-twin", tenant: "twin|a" });
	const portTwin = await findTenant("twin", 80);
	expect(portTwin).not.toBeNull();

	// And A never lost its original socket: the first worker is still reachable.
	const ackSolo = await probe(portA as number);
	expect(ackSolo.tenant).toBe("solo");

	await send({ type: "release", sessionId: "tab-solo" });
	await send({ type: "release", sessionId: "tab-twin" });
}, 90_000);

test("a STALE control socket left by a crashed manager is reclaimed on next start (xcsh #1846)", async () => {
	// Manager A binds, then is SIGKILL'd — SIGKILL runs no cleanup, so the unix
	// socket file is left on disk with nothing listening (exactly what a crash,
	// reboot, or `pkill -9` does). A successor manager on the same path must probe
	// (no live owner), reclaim the stale file, bind, and provision normally —
	// never crash on EADDRINUSE. (Dev `bun run` silently rebinds a stale socket, so
	// this guards the full run() wiring end-to-end; the compiled-only EADDRINUSE
	// branch is covered deterministically in acquire-control-socket.test.ts.)
	await startManager();
	mgr?.kill("SIGKILL");
	await mgr?.exited;
	mgr = undefined;
	expect(fs.existsSync(sock)).toBe(true); // a crashed manager leaves its socket file behind

	// Successor manager cold-starts on the SAME (now stale) socket path.
	mgr = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		env: { ...process.env, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: "0" },
		stdout: "ignore",
		stderr: "ignore",
	});
	// A healthy manager blocks forever; a crash-on-EADDRINUSE would exit fast.
	const outcome = await Promise.race([
		mgr.exited,
		new Promise<"alive">(resolve => setTimeout(() => resolve("alive"), 8000)),
	]);
	expect(outcome).toBe("alive");

	// And it actually works: provision spawns a real worker.
	await send({ type: "provision", sessionId: "tab-stale", tenant: "stale|staging" });
	const port = await findTenant("stale", 80);
	expect(port).not.toBeNull();
	await send({ type: "release", sessionId: "tab-stale" });
}, 60_000);
