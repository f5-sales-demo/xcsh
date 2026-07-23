/**
 * Supersede / recycle a foreground `xcsh office serve`.
 *
 * `office serve` binds a FIXED :8444 listener, so after a `brew upgrade` the old
 * serve squats the port on the stale binary and a fresh `office serve` dies with
 * "port 8444 in use". These helpers let the new serve step the old one down on
 * start (supersede), and give `office recycle` (run from brew post_install) a way
 * to stop the stale serve so the next start is clean — the office analog of
 * `chrome recycle`.
 *
 * Safety: we only ever signal a PID that (a) actually holds :8444 AND (b) looks
 * like an `office serve` (its `ps` command line contains "office serve"). A
 * foreign holder is reported, never killed — so PID reuse can't make us signal an
 * unrelated process.
 */
import { OFFICE_PANE_PORT } from "./office-pane-server";

/** Injectable seams so the wait/signal logic is unit-testable without real procs. */
export interface ServeLifecycleDeps {
	/** PID listening on `port`, or 0 if none/unknown (best-effort via lsof). */
	pidListeningOn: (port: number) => number;
	/** Whether `pid`'s command line is an `xcsh office serve`. */
	isOfficeServe: (pid: number) => boolean;
	/** Send a signal to `pid` (process.kill). */
	signal: (pid: number, sig: NodeJS.Signals) => void;
	/** Await `ms` (setTimeout in prod; immediate in tests). */
	sleep: (ms: number) => Promise<void>;
}

export interface SupersedeResult {
	/** True when a stale serve was found and stepped down. */
	superseded: boolean;
	/** The stale PID we signalled (present only when superseded). */
	pid?: number;
}

const WAIT_MS = 3000;
const POLL_MS = 100;

/** PID listening on `port`, or 0 (best-effort; lsof unavailable → 0). */
function pidListeningOn(port: number): number {
	try {
		const out = Bun.spawnSync(["lsof", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"])
			.stdout.toString()
			.trim()
			.split("\n")[0];
		const pid = Number(out);
		return Number.isInteger(pid) && pid > 0 ? pid : 0;
	} catch {
		return 0;
	}
}

/** Whether `pid`'s full command line is an `xcsh office serve` (ps, best-effort). */
function isOfficeServe(pid: number): boolean {
	try {
		const out = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="]).stdout.toString();
		return /office\s+serve/.test(out);
	} catch {
		return false;
	}
}

const defaultDeps: ServeLifecycleDeps = {
	pidListeningOn,
	isOfficeServe,
	signal: (pid, sig) => process.kill(pid, sig),
	sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

/** SIGTERM `pid` and poll until `port` is released by it, or throw on timeout. */
async function signalAndWait(pid: number, port: number, deps: ServeLifecycleDeps): Promise<void> {
	deps.signal(pid, "SIGTERM");
	for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
		await deps.sleep(POLL_MS);
		const now = deps.pidListeningOn(port);
		if (now <= 0 || now !== pid) return; // freed (or a different serve took over)
	}
	throw new Error(`Timed out waiting for the stale office serve (PID ${pid}) to release port ${port}.`);
}

/**
 * Step down a stale `office serve` holding `port` so a fresh serve can bind.
 * No-op when the port is free. Throws (without signalling) when the holder is not
 * an office serve — the caller should surface that rather than kill a stranger.
 */
export async function supersedeStaleServe(
	port = OFFICE_PANE_PORT,
	deps: ServeLifecycleDeps = defaultDeps,
): Promise<SupersedeResult> {
	const pid = deps.pidListeningOn(port);
	if (pid <= 0 || pid === process.pid) return { superseded: false };
	if (!deps.isOfficeServe(pid)) {
		throw new Error(
			`Port ${port} is held by PID ${pid}, which isn't an xcsh office serve. Stop it manually, then retry.`,
		);
	}
	await signalAndWait(pid, port, deps);
	return { superseded: true, pid };
}

/**
 * Stop a running `office serve` (if any) — used by `office recycle` and brew
 * post_install so an upgrade clears the stale serve. Returns a human message;
 * never throws for the ordinary cases (nothing running / foreign holder).
 */
export async function recycleOfficeServe(
	port = OFFICE_PANE_PORT,
	deps: ServeLifecycleDeps = defaultDeps,
): Promise<string> {
	const pid = deps.pidListeningOn(port);
	if (pid <= 0) return "No xcsh office serve is running.";
	if (!deps.isOfficeServe(pid)) {
		return `Port ${port} is held by PID ${pid}, which isn't an xcsh office serve — leaving it alone.`;
	}
	await signalAndWait(pid, port, deps);
	return `Stopped the running office serve (PID ${pid}). Start it again with \`xcsh office serve\`.`;
}
