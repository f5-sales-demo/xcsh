/**
 * Baseline benchmark for per-tab extension SESSION load/unload — the metric behind
 * "make session loading/unloading as fast as possible".
 *
 * A per-tab session is a worker PROCESS the manager spawns (manager.ts:151,
 * `Bun.spawn([execPath, "worker"], …)`, one per tab). This benchmark spawns real
 * workers the same way and self-times the lifecycle, complementing #1856's in-process
 * extension-loader benchmark (bench/extension-loading.ts).
 *
 * Run manually:  bun packages/coding-agent/bench/extension-session.ts
 *
 * Reports (self-measured with Bun.nanoseconds(), median of N runs):
 *  - bridge-ready:  spawn → the bridge is LISTENING (the INSTANT-ON latency before the
 *                   extension can connect; bridge starts before the heavy session init —
 *                   main.ts:797 / worker.ts:114). Detected with an HTTP probe: the worker
 *                   enforces an Origin check, so a real hello/hello_ack needs the
 *                   extension's origin — but a bound port answering HTTP (403/426) is a
 *                   faithful "port is up and accepting" proxy.
 *  - session-ready: spawn → ChatHandler attached. Measured by running the worker with
 *                   PI_TIMING=x, which prints the session:* span split then exits(0)
 *                   right after attach(). This is the true per-tab session-load cost.
 *  - unload:        graceful SIGTERM AFTER session-ready → process exit. Exercises the
 *                   real teardown (chatHandler.dispose + bridge.close, worker.ts:143-150)
 *                   the manager's `release` triggers — not a raw kill mid-init.
 *  - adopted:       local warm-spare adoption — bind a fully-warm spare (IPC) → worker acks
 *                   "bound" (identity set + re-announce). Tenant API-token validation is excluded
 *                   here AND from the cold session-ready baseline (no matching context in the bench
 *                   env), so the adopted-vs-session-ready delta isolates the avoided cold-start.
 *
 * Dev (bun src/cli.ts worker) and, if present, the compiled binary (dist/xcsh worker)
 * — the compiled number is the real per-tab floor users pay, per PR #1856 (~165ms
 * binary cold-start). Because each tab = a fresh worker process boot, binary-startup
 * wins propagate directly to session-ready. That link is what this benchmark quantifies.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const CLI = path.join(import.meta.dir, "../src/cli.ts");
const COMPILED = path.join(import.meta.dir, "../dist/xcsh");
const RUNS = 5; // cheap phases (bridge-ready, unload)
const SESSION_RUNS = 3; // session-ready spawns a full createAgentSession — fewer runs
const CONNECT_TIMEOUT_MS = 1_000;
const READY_DEADLINE_MS = 30_000;
const SESSION_DEADLINE_MS = 60_000;
// Settle window before the graceful-unload SIGTERM: long enough that createAgentSession
// + attach() have completed (session-ready lands ~0.2-1s after spawn) so the worker's
// SIGTERM handler is installed. NOT part of any measured interval.
const UNLOAD_SETTLE_MS = 2_500;
// Adoption warm-up: wait past session-ready so the spare's createAgentSession has finished
// → fully warm before bind. NOT part of any measured interval.
const ADOPT_SETTLE_MS = 2_500;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Find a free port in the manager's discovery range (19222-19241) to force via
 * XCSH_BRIDGE_PORT — mirrors manager.ts so resolveForcedPort accepts it. */
function pickFreePort(): number {
	for (let p = 19222; p <= 19241; p++) {
		try {
			const s = Bun.serve({ port: p, hostname: "127.0.0.1", fetch: () => new Response("") });
			s.stop(true);
			return p;
		} catch {
			/* in use — try next */
		}
	}
	throw new Error("no free port in 19222-19241 (is a manager or another app on the range?)");
}

function spawnWorker(cmd: string[], port: number, extraEnv: Record<string, string>) {
	return Bun.spawn(cmd, {
		env: {
			...process.env,
			XCSH_BROWSER_PROVIDER: "extension",
			XCSH_SESSION_ID: "tab-bench",
			XCSH_SESSION_TENANT: "acme|staging",
			XCSH_BRIDGE_PORT: String(port),
			// Isolate the tenant binding exactly as manager.ts does (undefined removes the var).
			XCSH_API_URL: undefined,
			XCSH_API_TOKEN: undefined,
			...extraEnv,
		},
		stdout: "ignore",
		stderr: extraEnv.PI_TIMING ? "pipe" : "ignore",
	});
}

/** True once the bridge is listening. The worker enforces an Origin check
 * (startBridgeServer with no skipOriginCheck), so a fake WS client is rejected — but
 * ANY HTTP response (403 bad-origin / 426 upgrade-required) proves the port is bound
 * and answering. Connection-refused (fetch throws) means not-yet. This is an
 * origin-independent, faithful "extension can connect" signal. */
async function bridgeListening(port: number): Promise<boolean> {
	try {
		await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
		return true; // got an HTTP status → the bridge server is up
	} catch {
		return false; // ECONNREFUSED / timeout → not listening yet
	}
}

/** Poll until the bridge is listening or the deadline passes. */
async function waitBridgeReady(port: number, deadlineMs: number): Promise<boolean> {
	const end = Bun.nanoseconds() + deadlineMs * 1e6;
	while (Bun.nanoseconds() < end) {
		if (await bridgeListening(port)) return true;
		await sleep(25);
	}
	return false;
}

async function measureBridgeReady(cmd: string[]): Promise<number> {
	const port = pickFreePort();
	const t0 = Bun.nanoseconds();
	const proc = spawnWorker(cmd, port, {});
	try {
		if (!(await waitBridgeReady(port, READY_DEADLINE_MS))) throw new Error("bridge never became ready");
		return (Bun.nanoseconds() - t0) / 1e6;
	} finally {
		proc.kill();
		await proc.exited;
	}
}

async function measureSessionReady(cmd: string[]): Promise<{ ms: number; spans: string }> {
	const port = pickFreePort();
	const t0 = Bun.nanoseconds();
	// PI_TIMING=x → worker prints session:* spans then exit(0) right after attach().
	const proc = spawnWorker(cmd, port, { PI_TIMING: "x" });
	// .catch so a stream torn down by kill() never becomes an unhandled rejection.
	const stderrText = new Response(proc.stderr as ReadableStream).text().catch(() => "");
	// proc.exited resolves to the exit code; race it against the deadline.
	const outcome = await Promise.race([proc.exited, sleep(SESSION_DEADLINE_MS).then(() => "timeout" as const)]);
	if (outcome === "timeout") {
		proc.kill();
		await proc.exited;
		await stderrText;
		throw new Error("session never became ready (createAgentSession did not complete — model/login configured?)");
	}
	// A crashed/failed worker exits FAST and non-zero — never record that as a quick success.
	if (outcome !== 0) {
		await stderrText;
		throw new Error(`worker exited ${outcome} before session-ready (see stderr — model/login configured?)`);
	}
	const ms = (Bun.nanoseconds() - t0) / 1e6;
	const spans =
		(await stderrText)
			.split("\n")
			.map(l => l.trim())
			.filter(l => l.includes("session:"))
			.join("  ") || "(no session:* spans over the 5ms log threshold)";
	return { ms, spans };
}

async function measureUnload(cmd: string[]): Promise<number> {
	const port = pickFreePort();
	const proc = spawnWorker(cmd, port, {});
	try {
		if (!(await waitBridgeReady(port, READY_DEADLINE_MS))) throw new Error("bridge never became ready");
		// Wait past session-ready so the worker's SIGTERM handler is installed (worker.ts
		// registers it only after createAgentSession + attach). Without this we'd measure a
		// default-action kill mid-init, not the graceful dispose the manager's release triggers.
		await sleep(UNLOAD_SETTLE_MS);
		const t1 = Bun.nanoseconds();
		proc.kill(); // SIGTERM → graceful shutdown() (chatHandler.dispose + bridge.close → exit 0)
		await proc.exited;
		return (Bun.nanoseconds() - t1) / 1e6;
	} finally {
		try {
			proc.kill();
		} catch {
			/* already gone */
		}
		await proc.exited;
	}
}

async function measureAdoption(cmd: string[]): Promise<number> {
	const port = pickFreePort();
	let onBound: (() => void) | null = null;
	const bound = new Promise<void>(res => { onBound = res; });
	const proc = Bun.spawn(cmd, {
		env: {
			...process.env,
			XCSH_BROWSER_PROVIDER: "extension",
			XCSH_BRIDGE_PORT: String(port),
			// identity-less spare — bound below via IPC
			XCSH_API_URL: undefined,
			XCSH_API_TOKEN: undefined,
		},
		ipc(message: unknown) {
			if ((message as { type?: string })?.type === "bound") onBound?.();
		},
		stdout: "ignore",
		stderr: "ignore",
	});
	try {
		if (!(await waitBridgeReady(port, READY_DEADLINE_MS))) throw new Error("spare never became ready");
		await sleep(ADOPT_SETTLE_MS); // ensure createAgentSession finished → fully warm
		const t0 = Bun.nanoseconds();
		(proc as { send(m: unknown): void }).send({ type: "bind", sessionId: "tab-bench", tenant: "acme|staging" });
		const timedOut = await Promise.race([bound.then(() => false), sleep(SESSION_DEADLINE_MS).then(() => true)]);
		if (timedOut) throw new Error("bind never acked");
		return (Bun.nanoseconds() - t0) / 1e6;
	} finally {
		try { proc.kill(); } catch { /* already gone */ }
		await proc.exited;
	}
}

async function repeat(n: number, fn: () => Promise<number>): Promise<number[]> {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(await fn());
	return out;
}

async function runSuite(label: string, cmd: string[]): Promise<void> {
	console.log(`\n=== ${label} ===`);

	try {
		const bridge = await repeat(RUNS, () => measureBridgeReady(cmd));
		console.log(`bridge-ready (spawn → listening):      ${median(bridge).toFixed(1)}ms  (median of ${RUNS})`);
	} catch (e) {
		console.log(`bridge-ready: N/A — ${(e as Error).message}`);
	}

	try {
		const session: number[] = [];
		let spans = "";
		for (let i = 0; i < SESSION_RUNS; i++) {
			const r = await measureSessionReady(cmd);
			session.push(r.ms);
			spans = r.spans;
		}
		console.log(`session-ready (spawn → attached):      ${median(session).toFixed(1)}ms  (median of ${SESSION_RUNS})`);
		console.log(`  span split (last run): ${spans}`);
	} catch (e) {
		console.log(`session-ready: N/A — ${(e as Error).message}`);
	}

	try {
		const adopt = await repeat(SESSION_RUNS, () => measureAdoption(cmd));
		console.log(`adopted (warm-spare bind → bound):     ${median(adopt).toFixed(1)}ms  (median of ${SESSION_RUNS})`);
		console.log("  local adoption only — tenant API-token validation excluded here & from session-ready above,");
		console.log("  so the delta reflects avoided process/module cold-start.");
	} catch (e) {
		console.log(`adopted: N/A — ${(e as Error).message}`);
	}

	try {
		const unload = await repeat(RUNS, () => measureUnload(cmd));
		console.log(`unload (graceful SIGTERM → exit):      ${median(unload).toFixed(1)}ms  (median of ${RUNS})`);
	} catch (e) {
		console.log(`unload: N/A — ${(e as Error).message}`);
	}
}

await runSuite("dev (bun src/cli.ts worker)", [process.execPath, CLI, "worker"]);

if (fs.existsSync(COMPILED)) {
	await runSuite("compiled (dist/xcsh worker)", [COMPILED, "worker"]);
} else {
	console.log(`\n(compiled binary ${path.relative(process.cwd(), COMPILED)} not found — run \`bun run build\` to include it)`);
}

process.exit(0);
