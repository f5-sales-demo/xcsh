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

export interface PortReaperDeps {
	/** PIDs holding any port in `spec` (an `lsof -i` port spec). */
	listPids(spec: string): Promise<number[]>;
	kill(pid: number, signal?: NodeJS.Signals): void;
	now(): number;
	sleep(ms: number): Promise<void>;
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

/** PIDs holding any of `ports`, excluding this process, in a single subprocess call. */
export async function pidsOnPorts(ports: readonly number[], deps: PortReaperDeps): Promise<number[]> {
	if (ports.length === 0) return [];
	const pids = await deps.listPids(portSpec(ports));
	// The test process itself holds outbound probe connections on these ports; killing it would end
	// the run.
	return pids.filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

export interface ReapOptions {
	/** Wall-clock budget for the whole wait. */
	budgetMs: number;
	/** Gap between polls. The real cost of a poll is the subprocess spawn, not this. */
	pollMs?: number;
}

export interface ReapResult {
	/** Ports still held when the budget ran out; empty on success. */
	heldPorts: number[];
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
 * Returning the still-held ports instead of throwing lets the caller fail with a diagnostic that
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

	while (true) {
		const pids = await pidsOnPorts(ports, deps);
		if (pids.length === 0) return { heldPorts: [], elapsedMs: deps.now() - started };

		for (const pid of pids) {
			try {
				deps.kill(pid, escalate ? "SIGKILL" : "SIGTERM");
			} catch {
				/* already gone */
			}
		}
		escalate = true;

		if (deps.now() >= deadline) {
			// Only now pay for the per-port detail, and only to describe the failure.
			const held: number[] = [];
			for (const port of ports) {
				if ((await deps.listPids(String(port))).some(pid => pid !== process.pid)) held.push(port);
			}
			return { heldPorts: held, elapsedMs: deps.now() - started };
		}
		await deps.sleep(pollMs);
	}
}
