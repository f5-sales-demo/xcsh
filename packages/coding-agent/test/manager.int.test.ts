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
import { afterEach, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VERSION } from "@f5-sales-demo/pi-utils";
import { probe } from "./helpers/bridge-probe";
import { requireSpans, SURVIVAL_BUDGET_MS, SURVIVAL_PROBE_INTERVAL_MS } from "./helpers/manager-waits";
import {
	type PortReaperDeps,
	parseLsofPids,
	pidsOnPorts,
	portSpec,
	REAP_BUDGET_MS,
	reapPorts,
	SWEEP_TIMEOUT_MS,
	TEARDOWN_HOOK_TIMEOUT_MS,
} from "./helpers/port-reaper";
import { describeManagerCensus, describePortScan, describeWaitFailure } from "./manager-wait-diagnostics";

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
//
// The sweep lives in test/helpers/port-reaper.ts because how it polls turned out to matter more
// than what it polls for: asking lsof about each port separately cost 556ms per poll idle and
// 952ms under load, so the loop that read like a 5s budget actually ran 28-48s and overran the
// hook timeout under full-suite concurrency (#2495). It now asks once for the whole range and
// stops at a wall-clock deadline.
const reaperDeps: PortReaperDeps = {
	listPids: async spec => {
		// Bounded: the deadline is only checked between sweeps, so one hung lsof would otherwise eat
		// the whole budget and let the hook time out instead of reporting.
		try {
			const proc = Bun.spawn(["lsof", "-ti", `tcp:${spec}`], { stdout: "pipe" });
			const text = await Promise.race([
				new Response(proc.stdout).text().catch(() => null),
				Bun.sleep(SWEEP_TIMEOUT_MS).then(() => null),
			]);
			if (text === null) {
				proc.kill("SIGKILL");
				// Indeterminate, NOT empty: a slow sweep under load must not be read as proof the ports
				// came back, or a live worker survives to serve the next test's probes.
				return null;
			}
			return parseLsofPids(text);
		} catch {
			// lsof is not installed. Nothing here can enumerate ports, and failing every teardown would
			// be worse than proceeding, so degrade to "no holders" as this file always has.
			return [];
		}
	},
	kill: (pid, signal) => process.kill(pid, signal),
	processTree: async () => {
		// One `ps` for the whole table; ownership is then a pure in-memory walk.
		const tree = new Map<number, number>();
		try {
			const out = await new Response(Bun.spawn(["ps", "-eo", "pid=,ppid="]).stdout).text();
			for (const line of out.split("\n")) {
				const [pid, ppid] = line.trim().split(/\s+/).map(Number);
				if (Number.isInteger(pid) && Number.isInteger(ppid)) tree.set(pid, ppid);
			}
		} catch {
			/* no tree available; ownership then matches only the PIDs we pass in directly */
		}
		return tree;
	},
	now: () => Date.now(),
	sleep: ms => Bun.sleep(ms),
};

/**
 * PIDs holding one specific port. Test bodies use this to assert on a single worker; an
 * indeterminate sweep reads as "none found" here, which only ever weakens an assertion rather than
 * letting a worker survive teardown (that case is handled in afterEach).
 */
async function pidsOnPort(port: number): Promise<number[]> {
	return (await pidsOnPorts([port], reaperDeps)) ?? [];
}

afterEach(async () => {
	mgr?.kill();
	mgr = undefined;
	mgrB?.kill();
	mgrB = undefined;

	// A kill is not a release. SIGTERM'd bound workers SELF-DRAIN (see killPid in
	// manager.ts), so without waiting here the next test starts while a worker from
	// this one still owns a RANGE port — and RANGE is only 4 ports wide. Measured
	// consequences on origin/main: the cold-spawn span test received
	// `worker_boot{cold:false, sid:"tab-solo"}`, i.e. the buffered spans of a
	// leftover worker from an ENTIRELY DIFFERENT test, and the two-tab test found
	// zero workers because the range was still occupied (#2463).
	// Ownership rests on the beforeAll check, not on ancestry: killing the manager deliberately
	// leaves its workers running, so by now they have been reparented to init and no ancestry walk
	// would recognise them as ours.
	const { heldPids, indeterminate, elapsedMs } = await reapPorts(
		RANGE,
		{ budgetMs: REAP_BUDGET_MS, ownership: { kind: "window-verified" } },
		reaperDeps,
	);

	if (heldPids.length > 0 || indeterminate) {
		// Fail with the cause named rather than by hook timeout, which names nothing.
		const cause = indeterminate
			? "no port sweep completed in time, so nothing proved they were released"
			: `still held by pid ${heldPids.join(", ")}`;
		throw new Error(
			`Teardown could not confirm ports ${portSpec(RANGE)} were reclaimed within ${REAP_BUDGET_MS}ms ` +
				`(waited ${elapsedMs}ms): ${cause}. A surviving worker would serve the next test's probes.`,
		);
	}

	if (sock) {
		try {
			fs.rmSync(sock, { force: true });
		} catch {
			/* best effort */
		}
	}
	// Explicit: bun defaults hooks to 5s, which is the reap budget itself — the hook would die before
	// the budget could report anything.
}, TEARDOWN_HOOK_TIMEOUT_MS);

/**
 * Claim the window before any test runs.
 *
 * Teardown reaps whatever holds these ports, which is only safe if they were ours to begin with.
 * Proving the window is empty up front is what makes that true — and if it is not, the run stops
 * here rather than killing a process it does not own.
 */
beforeAll(async () => {
	const holders = await pidsOnPorts(RANGE, reaperDeps);
	if (holders && holders.length > 0) {
		throw new Error(
			`Ports ${portSpec(RANGE)} are already held by pid ${holders.join(", ")} before any test ran. ` +
				"This run will not kill a process it does not own. Stop that process, or move this run's " +
				`window with XCSH_BRIDGE_PORT_START (currently ${PORT_BASE}).`,
		);
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
/**
 * Spawn a manager on a temp socket, wait for it to bind, and capture its stderr
 * live. Returns a reader for that stderr.
 *
 * stderr is captured for EVERY manager, not only the pool tests, because it is
 * the sole input to `describeManagerCensus`. Without it a failing test can say
 * that something did not happen but never what the manager did instead — which
 * is how the two-tab assertion below came to report `Received: 1` and nothing
 * more (#2463).
 */
async function spawnManager(poolSize: string, extraEnv: Record<string, string> = {}): Promise<() => string> {
	sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-")), "manager.sock");
	const proc = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		env: { ...process.env, ...BRIDGE_ENV, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: poolSize, ...extraEnv },
		stdout: "ignore",
		stderr: "pipe",
	});
	mgr = proc;
	let err = "";
	void (async () => {
		const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
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

/**
 * A manager with NO pre-warm pool. Cold-spawn tests below assert on the 4-port
 * RANGE, so spares must not occupy those ports; pool behaviour has its own tests.
 */
async function startManager(extraEnv: Record<string, string> = {}): Promise<() => string> {
	return await spawnManager("0", extraEnv);
}

/**
 * A bridge port window private to this test run.
 *
 * The default window (19222-19261) is global to the machine: every clone, every worktree, and the
 * developer's own live xcsh bridges share it. This file reaps "whatever holds my ports", so on the
 * shared window it both inherits other runs' workers and can SIGKILL a real session's bridge — the
 * codebase warns about exactly that ("NEVER kill ... port 19222 — that is YOUR OWN bridge").
 * Deriving a window from the PID gives each run its own, so teardown can only ever reach workers it
 * started (#2495).
 */
const PORT_BASE = 20_000 + (process.pid % 40) * 200;
const BRIDGE_ENV = { XCSH_BRIDGE_PORT_START: String(PORT_BASE) };

// Workers are assigned the LOWEST free range port; the T4 worker test pins base+17, so polling the
// low end of the range avoids colliding with it.
const RANGE = [PORT_BASE, PORT_BASE + 1, PORT_BASE + 2, PORT_BASE + 3];

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
	return await spawnManager(poolSize);
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

/** Poll captured manager stderr for a "on port <N>" line matching `re`. Avoids the
 *  bridge probe (which would consume the worker's first-connect cold-start flush). */
/**
 * Poll captured stderr for `re` and return its first capture group as a number.
 *
 * The default budget is 300 tries x 100ms = 30s. It was 80 tries = 8s, which was
 * the cause of the #2352 flake: "warm adopt emits worker_boot span with
 * cold=false" failed 2 runs in 5 at 8831 / 8844 / 8864 / 8868 / 8889 ms — ~800ms
 * of manager startup plus an exhausted 8s poll — after which `port` is null and
 * `expect(port).not.toBeNull()` fails. Those five observations sit within 90ms of
 * each other and are identical at bun's default 20-way concurrency and at the
 * `--max-concurrency 4` this package's test script uses, which is the signature
 * of a fixed deadline rather than CPU contention.
 *
 * 8s was also inconsistent with this file's own sibling helper: every
 * `waitForStderr` call site passes 120 tries x 150ms = 18s while waiting for the
 * same class of manager log line. There was no reason for the port wait to be
 * less patient.
 *
 * These are correctness waits, not latency assertions — the tests assert that a
 * log line eventually appears, never that it appears quickly. The enclosing tests
 * allow 60_000 ms, so 30s still fails well short of the test timeout on a real hang.
 *
 * On exhaustion this THROWS with a census of what the manager actually logged rather
 * than returning null for `expect(port).not.toBeNull()` to report. A bare "it was
 * null" is what made #2352 look like impatience and #2423 look like a repeat of it:
 * the same symptom is produced by a spare that never spawned, an adoption that never
 * ran, and an adoption that ran for another session id. See manager-wait-diagnostics.
 */
async function waitForPort(getErr: () => string, re: RegExp, tries = 300): Promise<number> {
	const intervalMs = 100;
	for (let i = 0; i < tries; i++) {
		const m = getErr().match(re);
		if (m) return Number(m[1]);
		await Bun.sleep(intervalMs);
	}
	throw new Error(describeWaitFailure({ pattern: re, tries, intervalMs, stderr: getErr() }));
}

/**
 * Budget for `requireSpans` to observe the stages it is waiting for.
 *
 * A correctness wait, not a latency assertion: the tests assert a span eventually
 * arrives with the right shape, never that it arrives quickly. The spans are
 * flushed only after `activateTenantContext` completes inside the bind closure,
 * which runs AFTER the "adopted spare" line is logged, so the gap this must cover
 * is not bounded by anything the test controls. The enclosing tests allow
 * 60_000 ms, so this still fails short of the test timeout on a real hang.
 *
 * Sizing this budget is NOT what makes the span waits reliable — waiting on the
 * required STAGES rather than on a span count is (#2364, see helpers/manager-waits.ts).
 */
const SPAN_COLLECT_TIMEOUT_MS = 30_000;

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

test("graceful shutdown frame reaps spares, removes the socket + manager.json, exits (#1874)", async () => {
	const getErr = await startManagerWithPool("1");
	expect(await waitForStderr(getErr, "pre-warmed spare", 120)).toBe(true);
	const statePath = path.join(path.dirname(sock), "manager.json");
	expect(fs.existsSync(statePath)).toBe(true);

	await send({ type: "shutdown", reason: "manual" });

	// The manager tears down: socket + liveness record removed within the drain window.
	let gone = false;
	for (let i = 0; i < 100; i++) {
		if (!fs.existsSync(sock) && !fs.existsSync(statePath)) {
			gone = true;
			break;
		}
		await Bun.sleep(100);
	}
	expect(gone).toBe(true);
	expect(getErr()).toContain("graceful shutdown (manual)");
	// A stale shutdown must not linger as a live manager: the socket no longer answers.
	expect(await request({ type: "hello" }, 800)).toBeNull();
}, 30_000);

test("superseded shutdown LEAVES bound workers alive for re-adoption; manual reaps them (#1874 Task 6)", async () => {
	const getErr = await startManagerWithPool("1");
	expect(await waitForStderr(getErr, "pre-warmed spare", 120)).toBe(true);
	await send({ type: "provision", sessionId: "tab-7", tenant: "acme|staging" });
	// Deterministic: wait for the manager's adopt log instead of a flaky WS bridge
	// probe (findTenant) that depends on context-activation timing under CI load —
	// the exact source of the ~50% CI flake at this line.
	const port = await waitForPort(getErr, /adopted spare pid \d+ on port (\d+) as tab-7 \(/);

	// Handoff reason → the worker's bridge must SURVIVE the manager exit (the
	// successor will re-adopt it), so its port keeps answering the handshake.
	await send({ type: "shutdown", reason: "superseded" });
	let socketGone = false;
	for (let i = 0; i < 100; i++) {
		if (!fs.existsSync(sock)) {
			socketGone = true;
			break;
		}
		await Bun.sleep(100);
	}
	expect(socketGone).toBe(true); // manager exited
	expect(getErr()).toContain("leaving 1 worker(s) for re-adoption");
	// Poll for survival: the worker's WS bridge should outlive the manager (zero-
	// downtime re-adoption). A just-adopted spare is briefly unresponsive while it
	// activates its tenant context, so the budget is sized against measurement —
	// see SURVIVAL_BUDGET_MS.
	let survived = false;
	let lastProbeErr = "(never attempted)";
	let lastTenant = "(no ack)";
	const survivalAttempts = Math.ceil(SURVIVAL_BUDGET_MS / SURVIVAL_PROBE_INTERVAL_MS);
	for (let i = 0; i < survivalAttempts; i++) {
		try {
			const ack = await probe(port);
			lastTenant = String(ack.tenant);
			if (ack.tenant === "acme") {
				survived = true;
				break;
			}
		} catch (e) {
			lastProbeErr = e instanceof Error ? e.message : String(e);
		}
		await Bun.sleep(SURVIVAL_PROBE_INTERVAL_MS);
	}
	// Say WHY the wait ended empty rather than asserting a bare boolean: "the worker
	// is gone" (nothing holding the port, connection refused) and "the worker is
	// alive but did not ack in time" are different defects, and `toBe(true)` cannot
	// tell them apart — the same silence that made #2352 look like impatience.
	if (!survived) {
		const holders = await pidsOnPort(port);
		throw new Error(
			[
				`worker did not outlive its manager: no "acme" ack on port ${port} within ${SURVIVAL_BUDGET_MS}ms`,
				`  pids still holding the port: ${holders.length > 0 ? holders.join(", ") : "NONE (the worker is gone)"}`,
				`  last ack tenant: ${lastTenant}`,
				`  last probe error: ${lastProbeErr}`,
				...describeManagerCensus(getErr()),
			].join("\n"),
		);
	}

	// Clean it up (no successor in this test) — SIGTERM the surviving worker's port.
	for (const pid of await pidsOnPort(port)) {
		try {
			process.kill(pid);
		} catch {
			/* gone */
		}
	}
}, 30_000);

test("`chrome recycle` steps down the running manager for an upgrade (#1874 Task 7)", async () => {
	await startManager();
	// Temp HOME so the wrapper refresh writes to a throwaway Chrome dir, not the
	// developer's real native-host manifest.
	const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-recycle-home-"));
	const rc = Bun.spawn(["bun", "src/cli.ts", "chrome", "recycle"], {
		cwd: process.cwd(),
		env: { ...process.env, ...BRIDGE_ENV, HOME: fakeHome, XCSH_MANAGER_SOCK: sock },
		stdout: "ignore",
		stderr: "ignore",
	});
	await rc.exited;
	let gone = false;
	for (let i = 0; i < 100; i++) {
		if (!fs.existsSync(sock)) {
			gone = true;
			break;
		}
		await Bun.sleep(100);
	}
	expect(gone).toBe(true); // recycle sent {shutdown, reason:"updated"} → manager stepped down
	fs.rmSync(fakeHome, { recursive: true, force: true });
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
		env: { ...process.env, ...BRIDGE_ENV, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: "0" },
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
	const getErr = await startManager();

	// Two tabs of the SAME tenant, keyed by distinct sessionIds. The manager keys
	// its registry on sessionId, not tenant, so each tab gets its OWN worker on its
	// own range port — even though both advertise the same tenant "acme".
	await send({ type: "provision", sessionId: "tab-101", tenant: "acme|staging" });
	await send({ type: "provision", sessionId: "tab-102", tenant: "acme|staging" });

	// Both workers should come up on distinct range ports, both advertising "acme".
	// Keep what each port LAST said instead of discarding it: a bare count cannot
	// separate "the second worker never spawned" from "it spawned late" from "it
	// answered under another tenant", and CI has reported this as `Received: 1`
	// with nothing else to go on (#2463).
	const ports = new Set<number>();
	const lastSeen = new Map<number, { tenant?: string; error?: string }>();
	await (async () => {
		for (let i = 0; i < 80 && ports.size < 2; i++) {
			for (const p of RANGE) {
				try {
					const a = await probe(p);
					lastSeen.set(p, { tenant: String(a.tenant) });
					if (a.tenant === "acme") ports.add(p);
				} catch (e) {
					lastSeen.set(p, { error: e instanceof Error ? e.message : String(e) });
				}
			}
			await Bun.sleep(250);
		}
	})();
	if (ports.size !== 2) {
		// Who holds a silent port is the datum that separates "the worker died" from
		// "it is up but not serving" — the ambiguity that left three Mode C occurrences
		// unresolved (#2463). Enumerated only on the failure path, so the happy path
		// pays nothing.
		const holdersByPort = new Map<number, number[]>();
		for (const p of RANGE) holdersByPort.set(p, await pidsOnPort(p));
		throw new Error(
			[
				`expected 2 distinct range ports advertising "acme", saw ${ports.size}`,
				...describePortScan(
					RANGE.map(p => ({
						port: p,
						...(lastSeen.get(p) ?? { error: "never probed" }),
						holders: holdersByPort.get(p),
					})),
					"acme",
				),
				...describeManagerCensus(getErr()),
			].join("\n"),
		);
	}

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
			...BRIDGE_ENV,
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
		env: { ...process.env, ...BRIDGE_ENV, XCSH_MANAGER_SOCK: sock },
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
		env: { ...process.env, ...BRIDGE_ENV, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: "0" },
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

test("cold spawn emits manager_provision + worker_boot spans with cold=true", async () => {
	const getErr = await startManagerWithPool("0"); // no spares -> cold spawn
	await send({ type: "provision", sessionId: "tab-501", tenant: "acme|production" });
	const port = await waitForPort(getErr, /provisioned tab-501 .* on port (\d+)/);

	// Wait for the STAGES asserted below, not for a span count (#2364).
	const spans = await requireSpans(port, ["manager_provision", "worker_boot"], SPAN_COLLECT_TIMEOUT_MS, getErr);
	const byStage = Object.fromEntries(spans.map(s => [String(s.stage), s]));
	expect(byStage.manager_provision).toBeDefined(); // NOTE: ~0ms by construction; assert presence, NOT a duration
	expect(byStage.worker_boot).toBeDefined();
	expect(byStage.worker_boot.cold).toBe(true);
	expect(byStage.worker_boot.sid).toBe("tab-501");
	expect(typeof byStage.worker_boot.ms).toBe("number");
}, 60_000);

test("warm adopt emits worker_boot span with cold=false", async () => {
	const getErr = await startManagerWithPool("1"); // one warm spare -> adopt

	// Establish the PRECONDITION before provisioning: the spare must actually be in
	// the pool. `adoptSpare` does `pool.shift()` and, on an empty pool, the caller
	// falls back to `spawnWorker` — a cold spawn that logs "provisioned tab-777"
	// and NEVER logs "adopted spare … as tab-777". A provision racing the pool fill
	// therefore waits out the port budget in full, whatever that budget is: the
	// awaited line is not late, it does not exist in that run. That is the #2352 /
	// #2423 flake — failures at 8831-8889ms against an 8s budget and at
	// 31040-31588ms against the raised 30s one, i.e. always ~startup + the whole
	// budget, which is the signature of a line that never arrives rather than of
	// impatience. `pool.push` precedes the log (manager.ts), so this line arriving
	// means the spare is already in the pool. The three sibling adoption tests
	// above already wait here; this one did not.
	expect(await waitForStderr(getErr, "pre-warmed spare", 120)).toBe(true);

	await send({ type: "provision", sessionId: "tab-777", tenant: "acme|production" });
	const port = await waitForPort(getErr, /adopted spare pid \d+ on port (\d+) as tab-777/);

	// The wait must cover activateTenantContext, which runs inside the bind closure
	// AFTER the "adopted" log is printed — so the port is known well before the
	// spans are flushed. See SPAN_COLLECT_TIMEOUT_MS.
	const spans = await requireSpans(port, ["worker_boot"], SPAN_COLLECT_TIMEOUT_MS, getErr);
	const wb = spans.find(s => s.stage === "worker_boot");
	expect(wb).toBeDefined();
	expect(wb!.cold).toBe(false);
	expect(wb!.sid).toBe("tab-777");
}, 60_000);

// #upgrade-recycle: a manager whose binary was removed by `brew upgrade`+`brew cleanup`
// can no longer spawn workers, so it must step down on the next provision (XCSH_FORCE_STALE
// simulates the deleted binary in the dev harness, which is otherwise never "compiled").
test("a manager on a STALE binary refuses the next provision (draining) and steps down", async () => {
	await startManager({ XCSH_FORCE_STALE: "1" });
	// Spawning would ENOENT on the deleted binary → the provision is refused with the
	// existing `draining` contract so the host retries the successor manager.
	const reply = await request({ type: "provision", sessionId: "tab-1", tenant: "acme|staging" });
	expect(reply).toEqual({ type: "draining" });
	// gracefulShutdown("updated") removes the socket + manager.json and exits.
	let gone = false;
	for (let i = 0; i < 50; i++) {
		if (!fs.existsSync(sock)) {
			gone = true;
			break;
		}
		await Bun.sleep(100);
	}
	expect(gone).toBe(true);
}, 30_000);

test("a HEALTHY manager (present binary) never recycles — provisions normally, stays up", async () => {
	await startManager(); // dev binary present → not stale
	// A normal provision writes NO control reply (only draining does) → request times out → null.
	const reply = await request({ type: "provision", sessionId: "tab-1", tenant: "acme|staging" }, 1500);
	expect(reply).toBeNull(); // NOT draining — the manager served it
	// Still alive: socket persists and the hello handshake still answers.
	expect(fs.existsSync(sock)).toBe(true);
	const ack = await request({ type: "hello" });
	expect(ack?.type).toBe("manager_hello_ack");
}, 30_000);
