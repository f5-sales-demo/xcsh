/**
 * Reaping the worker ports an integration test leaves bound.
 *
 * `manager.int.test.ts` spawns real worker subprocesses that bind a narrow port range, and killing
 * the manager does not reap them. Teardown therefore has to wait for those ports to come back
 * before the next test starts, or a leftover worker silently serves the next test's probes.
 *
 * The obvious shape for that wait — poll N times with a short sleep — is a trap here, because the
 * poll itself is the expensive part. Asking `lsof` about four ports means four subprocess spawns,
 * measured at 556 ms idle and 952 ms under load, so a "50 iterations × 100 ms sleep" loop that
 * reads like a 5 s budget actually runs for 28-48 s and blows the hook timeout (#2495).
 *
 * So this module does two things: it asks about the whole port set in **one** spawn, and it bounds
 * the wait by **wall clock** rather than by iteration count, so the budget is the number written
 * down rather than an emergent property of how fast `lsof` happens to be today.
 */

/**
 * PIDs from `lsof -ti` output.
 *
 * `lsof` prints nothing when no process holds the port, and `Number("")` is 0 — so a parse that
 * only checks `Number.isInteger` reports PID 0 as a holder and every free port looks occupied.
 * Requiring a positive integer is what keeps a released port from failing teardown.
 */
export function parseLsofPids(out: string): number[] {
	return out
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.map(Number)
		.filter(pid => Number.isInteger(pid) && pid > 0);
}

/**
 * Wall-clock budget for reclaiming the port range.
 *
 * Two constraints fix this number. It must sit comfortably *under* the hook timeout below, or the
 * hook dies first and the diagnostic this budget exists to produce never runs. And it must not be
 * shorter than the drain a healthy worker actually needs: the loop this replaced looked like a 5s
 * budget but really waited up to ~28s, so adopting the nominal number would have cut the real grace
 * period by 5x and failed teardown on perfectly normal shutdowns.
 */
export const REAP_BUDGET_MS = 15_000;

/**
 * Explicit timeout for the teardown hook.
 *
 * Bun defaults hooks to 5s. Leaving the default meant the budget above could never fire first, so
 * the hook is given room for the budget plus the rest of teardown (manager kills, socket removal,
 * and the sweep already in flight when the deadline lands).
 */
export const TEARDOWN_HOOK_TIMEOUT_MS = 30_000;

/**
 * Cap on a single sweep. Long enough that a merely slow `lsof` under load still answers — calling it
 * indeterminate too eagerly fails teardown for no reason — but short enough that several sweeps fit
 * inside the budget.
 */
export const SWEEP_TIMEOUT_MS = 5_000;

export interface PortReaperDeps {
	/**
	 * PIDs holding any port in `spec` (an `lsof -i` port spec), or null when that could not be
	 * determined — a sweep that timed out, say. Null is not the same as "none": treating an
	 * indeterminate sweep as proof the ports are free is how a live worker survives teardown.
	 */
	listPids(spec: string): Promise<number[] | null>;
	kill(pid: number, signal?: NodeJS.Signals): void;
	/** pid -> ppid for every process, in one call, so ownership can be checked cheaply. */
	processTree(): Promise<Map<number, number>>;
	now(): number;
	sleep(ms: number): Promise<void>;
}

/**
 * How a caller proves a port holder is theirs.
 *
 * Killing whatever `lsof` reports is how a test comes to SIGKILL a developer's own bridge. Both
 * options below rule that out, but they suit different situations:
 *
 * - `window-verified` — the caller confirmed the window was unoccupied before using it, so anything
 *   on it afterwards is theirs. This is the right choice when the processes being reaped are
 *   deliberately orphaned, because then no parent survives to descend from.
 * - `descendants` — ownership by process ancestry. Precise, but useless once the parent has exited
 *   and the children have been reparented to init.
 */
export type PortOwnership = { kind: "window-verified" } | { kind: "descendants"; of: readonly number[] };

/** True when `pid` is, or descends from, any of `ancestors`. */
export function isOwned(pid: number, ancestors: readonly number[], tree: ReadonlyMap<number, number>): boolean {
	const owners = new Set(ancestors);
	let current: number | undefined = pid;
	// Bounded walk: a cycle or a very deep tree must not hang teardown.
	for (let hops = 0; current !== undefined && current > 1 && hops < 64; hops++) {
		if (owners.has(current)) return true;
		current = tree.get(current);
	}
	return false;
}

/**
 * An `lsof -i` port spec covering every port, as one argument.
 *
 * A contiguous run collapses to `lo-hi`; anything else becomes a comma list. Either way `lsof` is
 * invoked once, which is the whole point — the caller only needs the union of holding PIDs, never
 * which port each came from.
 */
export function portSpec(ports: readonly number[]): string {
	if (ports.length === 0) return "";
	const sorted = [...ports].sort((a, b) => a - b);
	const contiguous = sorted.every((port, index) => index === 0 || port === sorted[index - 1] + 1);
	return contiguous && sorted.length > 1 ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join(",");
}

/**
 * PIDs holding any of `ports`, excluding this process, in a single subprocess call.
 *
 * Returns null when the sweep could not answer, which callers must not read as "free".
 */
export async function pidsOnPorts(ports: readonly number[], deps: PortReaperDeps): Promise<number[] | null> {
	if (ports.length === 0) return [];
	const pids = await deps.listPids(portSpec(ports));
	if (pids === null) return null;
	// The test process itself holds outbound probe connections on these ports; killing it would end
	// the run.
	return pids.filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

export interface ReapOptions {
	/** Wall-clock budget for the whole wait. */
	budgetMs: number;
	/** Gap between polls. The real cost of a poll is the subprocess spawn, not this. */
	pollMs?: number;
	/** How the caller establishes that a holder is theirs to kill. */
	ownership: PortOwnership;
}

export interface ReapResult {
	/** PIDs still holding a port when the budget ran out; empty on success. */
	heldPids: number[];
	/**
	 * Holders that are not ours. Never signalled — reported so the developer learns another process
	 * owns the window rather than having it killed out from under them.
	 */
	foreignPids: number[];
	/**
	 * True when the budget expired without a sweep that could answer. The ports may well be free,
	 * but nothing here proved it, and quietly assuming so is what lets a live worker serve the next
	 * test's probes.
	 */
	indeterminate: boolean;
	/** How long the wait actually took, for a diagnostic that can name the real cost. */
	elapsedMs: number;
}

/**
 * Wait for `ports` to be released, escalating to SIGKILL, and give up at the budget.
 *
 * Callers have already signalled the holders; this only waits and escalates. A holder that has not
 * released by the first re-check is SIGKILLed rather than given further grace — no test here
 * asserts on a graceful drain that outlives its own body, so teardown has no reason to be patient.
 *
 * Returning the still-holding PIDs instead of throwing lets the caller fail with a diagnostic that
 * names them, which is strictly more useful than a hook timeout that names nothing.
 */
export async function reapPorts(
	ports: readonly number[],
	options: ReapOptions,
	deps: PortReaperDeps,
): Promise<ReapResult> {
	const pollMs = options.pollMs ?? 100;
	const started = deps.now();
	const deadline = started + options.budgetMs;
	let escalate = false;

	let lastSweepAnswered = false;

	while (true) {
		const pids = await pidsOnPorts(ports, deps);
		lastSweepAnswered = pids !== null;
		if (pids !== null && pids.length === 0) {
			return { heldPids: [], foreignPids: [], indeterminate: false, elapsedMs: deps.now() - started };
		}

		// Only ever signal our own. A holder we did not start is someone else's process, and killing
		// it is the hazard this whole change exists to remove.
		const held = pids ?? [];
		let ours = held;
		let foreign: number[] = [];
		if (options.ownership.kind === "descendants") {
			const tree = held.length > 0 ? await deps.processTree() : new Map<number, number>();
			const owners = options.ownership.of;
			ours = held.filter(pid => isOwned(pid, owners, tree));
			foreign = held.filter(pid => !isOwned(pid, owners, tree));
		}

		for (const pid of ours) {
			try {
				deps.kill(pid, escalate ? "SIGKILL" : "SIGTERM");
			} catch {
				/* already gone */
			}
		}
		escalate = true;

		// A foreign holder will never be reaped by us, so waiting out the budget is pointless.
		if (ours.length === 0 && foreign.length > 0) {
			return { heldPids: [], foreignPids: foreign, indeterminate: false, elapsedMs: deps.now() - started };
		}

		if (deps.now() >= deadline) {
			// Report from the sweep already in hand. Querying each port for a prettier message would
			// add unbounded subprocess time *after* the budget is blown — the very overrun this bound
			// exists to prevent — and the holding PIDs identify the leak just as well.
			return {
				heldPids: ours,
				foreignPids: foreign,
				indeterminate: !lastSweepAnswered,
				elapsedMs: deps.now() - started,
			};
		}
		await deps.sleep(pollMs);
	}
}
