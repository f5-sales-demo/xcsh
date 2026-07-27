/**
 * Why a `waitForPort` poll ended empty (#2423).
 *
 * `manager.int.test.ts` waits for a "on port <N>" line in the manager's stderr. When
 * that line never arrives the test used to fail as `expect(port).not.toBeNull()` — a
 * bare "it was null", carrying none of the stderr the helper had just spent 30s
 * reading. #2418 read that silence as impatience and raised the budget 8s → 30s. The
 * symptom returned just past the raised budget, which is the point at which "wait
 * longer" stops being a diagnosis: the same failure is also produced by a spare that
 * was never spawned, and by an adoption that fired for a different session id.
 *
 * So the timeout explains itself instead. The census below is deliberately about
 * DISTINGUISHING those cases, not about proving any one of them:
 *
 *   spares pre-warmed: 0   adoptions logged: 0  → the pool never filled
 *   spares pre-warmed: 2   adoptions logged: 0  → spares exist, adoption never ran
 *   spares pre-warmed: 2   adoptions logged: 1  → adoption ran, for another session
 *                                                 (or later than the budget allowed)
 *
 * Kept as a pure function so it can be tested against synthetic stderr in
 * milliseconds; asserting on it through the real helper would cost a 30s wait per
 * case. Same reasoning as extracting any other diagnostic that a test cannot reach.
 */

/** The manager's pre-warm log: `[xcsh manager] pre-warmed spare → pid 11 on port 19222`. */
const SPARE_SPAWNED = /pre-warmed spare →/g;
/** The manager's adoption log: `... adopted spare pid 11 on port 19222 as tab-7 (...)`. */
const SPARE_ADOPTED = /adopted spare pid \d+ on port \d+ as \S+/g;

/** How many trailing stderr lines to quote. Enough to hold a late line, few enough to read. */
const TAIL_LINES = 25;

export interface WaitFailure {
	/** The regex the helper was polling for. */
	readonly pattern: RegExp;
	/** Polls attempted before giving up. */
	readonly tries: number;
	/** Delay between polls, in ms. */
	readonly intervalMs: number;
	/** Everything captured from the manager's stderr so far. */
	readonly stderr: string;
}

/**
 * What the manager actually reported, as message lines.
 *
 * Split out from {@link describeWaitFailure} because the port wait is not the only
 * wait in this file that can end empty and need the same census: the span wait
 * (`requireSpans`, see helpers/manager-waits.ts) and the worker-survival poll both
 * fail for reasons the manager's own log explains. Each caller supplies its own
 * heading and appends this; there is one census implementation, not three.
 */
export function describeManagerCensus(stderr: string): string[] {
	const spares = stderr.match(SPARE_SPAWNED)?.length ?? 0;
	const adoptions = stderr.match(SPARE_ADOPTED) ?? [];

	const lines = [`  spares pre-warmed: ${spares}   adoptions logged: ${adoptions.length}`];

	// Quote the adoption lines verbatim: an adoption for a different session id is
	// invisible in the counts and is otherwise indistinguishable from no adoption.
	for (const adoption of adoptions) lines.push(`  adopted: ${adoption.trim()}`);

	if (stderr.trim() === "") {
		lines.push("  the manager captured no stderr — it may not have started");
		return lines;
	}

	const all = stderr.split("\n");
	const tail = all.slice(-TAIL_LINES);
	if (all.length > tail.length) lines.push(`  ... ${all.length - tail.length} earlier lines omitted`);
	lines.push("  manager stderr (tail):");
	for (const line of tail) lines.push(`    ${line}`);

	return lines;
}

/**
 * A failure message that says what was awaited, for how long, and what the manager
 * actually reported — enough to classify the next occurrence without re-running it.
 */
export function describeWaitFailure({ pattern, tries, intervalMs, stderr }: WaitFailure): string {
	return [
		`waitForPort never matched ${String(pattern)}`,
		`  budget exhausted: ${tries} tries x ${intervalMs}ms = ${tries * intervalMs}ms`,
		...describeManagerCensus(stderr),
	].join("\n");
}
