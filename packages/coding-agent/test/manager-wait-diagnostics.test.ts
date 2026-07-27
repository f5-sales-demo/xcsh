/**
 * What a `waitForPort` timeout is allowed to tell you (#2423).
 *
 * The manager integration test used to fail as a bare `expect(port).not.toBeNull()`,
 * which says a port never appeared and nothing about why. #2418 read that silence as
 * impatience and raised the budget 8s → 30s; the symptom then reappeared just past
 * the raised budget, and there was still no way to tell "the spare was never spawned"
 * from "adoption happened, late" from "adoption happened for a different session".
 * Raising the number again would keep that ambiguity, so the timeout now has to
 * explain itself. This is the pure part of that, so it is testable without waiting.
 */
import { describe, expect, test } from "bun:test";
import { describeWaitFailure } from "./manager-wait-diagnostics";

const PATTERN = /adopted spare pid \d+ on port (\d+) as tab-7 \(/;

describe("describeWaitFailure", () => {
	test("names the pattern and the exhausted budget", () => {
		const msg = describeWaitFailure({ pattern: PATTERN, tries: 300, intervalMs: 100, stderr: "" });
		expect(msg).toContain(String(PATTERN));
		// The budget must appear as a duration, not only as a poll count — 300 tries
		// means nothing to someone reading CI output for the first time.
		expect(msg).toContain("300 tries");
		expect(msg).toContain("30000ms");
	});

	test("an empty stderr is called out as the manager never logging at all", () => {
		const msg = describeWaitFailure({ pattern: PATTERN, tries: 2, intervalMs: 100, stderr: "" });
		expect(msg).toContain("captured no stderr");
	});

	test("reports that no spare was ever pre-warmed", () => {
		const stderr = "[xcsh manager] listening on /tmp/x.sock\n[xcsh manager] pool target 0\n";
		const msg = describeWaitFailure({ pattern: PATTERN, tries: 2, intervalMs: 100, stderr });
		expect(msg).toContain("spares pre-warmed: 0");
	});

	test("counts pre-warmed spares, so 'never spawned' is distinguishable from 'never adopted'", () => {
		const stderr = [
			"[xcsh manager] pre-warmed spare → pid 11 on port 19222",
			"[xcsh manager] pre-warmed spare → pid 12 on port 19223",
		].join("\n");
		const msg = describeWaitFailure({ pattern: PATTERN, tries: 2, intervalMs: 100, stderr });
		expect(msg).toContain("spares pre-warmed: 2");
		expect(msg).toContain("adoptions logged: 0");
	});

	test("an adoption for a DIFFERENT session is surfaced rather than looking like no adoption", () => {
		// The wait is keyed to tab-7; an adoption as tab-999 never matches the pattern,
		// and reading "adoptions logged: 0" would send the next person hunting the pool.
		const stderr = "[xcsh manager] adopted spare pid 11 on port 19222 as tab-999 (handoff)";
		const msg = describeWaitFailure({ pattern: PATTERN, tries: 2, intervalMs: 100, stderr });
		expect(msg).toContain("adoptions logged: 1");
		expect(msg).toContain("tab-999");
	});

	test("keeps the tail of stderr, which is where a late line would show", () => {
		const lines = Array.from({ length: 60 }, (_, i) => `line-${i}`);
		const msg = describeWaitFailure({
			pattern: PATTERN,
			tries: 2,
			intervalMs: 100,
			stderr: lines.join("\n"),
		});
		expect(msg).toContain("line-59");
		// Bounded: a 60-line dump in a CI log buries the finding it is meant to expose.
		expect(msg).not.toContain("line-0\n");
		expect(msg).toContain("earlier lines omitted");
	});
});
