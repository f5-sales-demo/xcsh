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
import { describePortScan, describeWaitFailure } from "./manager-wait-diagnostics";

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

describe("describePortScan (#2463 mode C)", () => {
	test("names which ports answered and with what tenant, so a wrong tenant is not silence", () => {
		// The failure this exists for: the two-tab test asserted a bare `ports.size`
		// while swallowing every probe error, so `Received: 1` said nothing about
		// whether the second worker was absent, late, or answering another tenant.
		const lines = describePortScan(
			[
				{ port: 19222, tenant: "example-corp" },
				{ port: 19223, tenant: "example-stale" },
				{ port: 19224, error: "connect ECONNREFUSED 127.0.0.1:19224" },
				{ port: 19225, error: "connect ECONNREFUSED 127.0.0.1:19225" },
			],
			"example-corp",
		).join("\n");
		expect(lines).toContain("19222");
		expect(lines).toContain("example-corp");
		expect(lines).toContain("19223");
		expect(lines).toContain("stale"); // a DIFFERENT tenant is the interesting case
		expect(lines).toContain("ECONNREFUSED");
		expect(lines).toContain("matched 1 of 4"); // how many satisfied the wanted tenant
	});

	test("distinguishes 'nothing listening anywhere' from 'listening but wrong tenant'", () => {
		const allRefused = describePortScan(
			[
				{ port: 19222, error: "ECONNREFUSED" },
				{ port: 19223, error: "ECONNREFUSED" },
			],
			"example-corp",
		).join("\n");
		expect(allRefused).toContain("no port answered at all");

		const wrongTenant = describePortScan([{ port: 19222, tenant: "example-other" }], "example-corp").join("\n");
		expect(wrongTenant).not.toContain("no port answered at all");
		expect(wrongTenant).toContain("matched 0 of 1");
	});
});

describe("describePortScan reports who holds a silent port (#2463)", () => {
	/**
	 * Mode C recurred on main with #2533 present (run 30328598436, 21160ms). The scan
	 * showed both workers provisioned on distinct ports and the FIRST one silent:
	 *
	 *     24800: no answer — ws error
	 *     24801: tenant "example-corp"
	 *
	 * and could go no further, because "no answer" covers two different defects. A dead
	 * worker means something killed it; a live one that never answers means its bridge
	 * failed to come up or its event loop is stalled. The survival diagnostic already
	 * reports holder pids for exactly this reason (#2539); the scan did not, so a third
	 * occurrence was spent without resolving it.
	 */
	test("a silent port with a live holder is distinguished from a vacant one", () => {
		const lines = describePortScan(
			[
				{ port: 24800, error: "ws error", holders: [13389] },
				{ port: 24801, tenant: "example-corp" },
				{ port: 24802, error: "ws error", holders: [] },
			],
			"example-corp",
		).join("\n");
		expect(lines).toContain("24800");
		expect(lines).toContain("13389"); // alive but not answering — bridge/event-loop
		expect(lines).toContain("nothing holds it"); // 24802 is genuinely vacant
	});

	test("says so explicitly when a silent port has no holder — the worker is gone", () => {
		const lines = describePortScan([{ port: 24800, error: "ECONNREFUSED", holders: [] }], "example-corp").join("\n");
		expect(lines).toContain("nothing holds it");
		expect(lines).not.toContain("held by");
	});

	test("omits holder wording when the caller could not enumerate", () => {
		// lsof absent, or the sweep failed: unknown must not read as "gone".
		const lines = describePortScan([{ port: 24800, error: "ws error" }], "example-corp").join("\n");
		expect(lines).not.toContain("nothing holds it");
		expect(lines).not.toContain("held by");
	});

	test("an answering port needs no holder annotation", () => {
		const lines = describePortScan([{ port: 24801, tenant: "example-corp", holders: [13391] }], "example-corp").join(
			"\n",
		);
		expect(lines).toContain('tenant "example-corp"');
		expect(lines).not.toContain("13391"); // it answered; who holds it adds nothing
	});
});
