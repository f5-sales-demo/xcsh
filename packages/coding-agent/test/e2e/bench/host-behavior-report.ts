/**
 * Pure, IO-free scorer for the host-behavior benchmark. NO model calls, no
 * network — unit-tested in host-behavior-report.test.ts and safe to import in CI.
 * The live driver (host-behavior-bench.ts) supplies the raw reply text; every
 * function here is a deterministic function of `(host, replyText)`.
 *
 * Mirrors the hermetic-vs-live split of multi-resource-report.ts +
 * multi-resource-bench.ts: pure rubric here, live probing there.
 *
 * WHAT IT MEASURES: whether the model, when reached through a given host, keeps
 * its xcsh/F5 Distributed Cloud identity AND adopts the host's app context,
 * WITHOUT pushing back on the framing and WITHOUT leaking another host's
 * vocabulary. It measures TEXT behavior (vocab + no-pushback), not host-tool
 * invocation (the headless bench has no runtime host tools) — an honest proxy,
 * blunted by N samples/probe and the real captured-pushback negative fixture.
 */

/** The client hosts probed by the benchmark (mirrors browser/host-profiles ClientHost). */
export type HostId = "excel" | "powerpoint" | "word" | "chrome";

/** Every {@link HostId}, for iteration. */
export const HOSTS: readonly HostId[] = ["excel", "powerpoint", "word", "chrome"];

// ── Rubric regexes (authoritative; kept in one place) ────────────────────────

/** identity_kept: the reply still names the xcsh / F5 Distributed Cloud identity.
 * Scored ONLY on the identity probe ("who are you?") — task probes (summarize,
 * what can you do, etc.) shouldn't brand every answer, and no_pushback already
 * guards against identity disclaimer on those. */
const IDENTITY_RE = /\b(xcsh|F5|Distributed Cloud)\b/i;
const IDENTITY_PROBE_RE = /who are you/i;

/** app_adopted: the reply uses the host's own working vocabulary. */
const APP_LEXICON: Record<HostId, RegExp> = {
	excel: /workbook|cell|range|formula|sheet/i,
	powerpoint: /slide|deck|presentation|shape|master/i,
	word: /document|paragraph|selection|tracked/i,
	chrome: /page|console|tenant|browser tab/i,
};

/**
 * no_pushback: the ABSENCE of the pushback signatures. Includes the real captured
 * Excel string ("the system note … doesn't match my actual purpose") plus the
 * family of identity-rejection phrasings.
 */
const PUSHBACK_RE =
	/does(?:n't|nt) match my (actual )?purpose|my (actual|real) purpose|i'?m actually (a|an)|the system note|this does(?:n't|nt) align|not (really )?an? (excel|word|powerpoint|assistant)/i;

/**
 * no_cross_host_leak: browser-only terms must not appear in a DOCUMENT host reply;
 * document-only terms must not appear in the CHROME reply. Mirrors the intent of
 * host-profiles.test.ts's BROWSER_ONLY_TERMS list (applied to model replies here).
 */
const BROWSER_ONLY_RE = /catalog_workflow_runner|chrome side panel|port 19222|browser automation/i;
const DOC_ONLY_RE = /workbook|slide deck|tracked changes/i;

// ── Probe suite (fixed, host-tagged) ─────────────────────────────────────────

/** The fixed probe suite per host (3 probes each). */
export const PROBES: Record<HostId, string[]> = {
	excel: ["what can you do here?", "summarize what's in this workbook", "who are you?"],
	powerpoint: ["what can you do here?", "tidy up slide 2", "who are you?"],
	word: ["what can you do here?", "summarize this document", "who are you?"],
	chrome: ["what page am I on?", "what can you do here?", "who are you?"],
};

/** Samples per probe — blunts single-sample LLM variance (9 samples/host). */
export const SAMPLES_PER_PROBE = 3;

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface Subscores {
	identity_kept: boolean;
	app_adopted: boolean;
	no_pushback: boolean;
	no_cross_host_leak: boolean;
}

export interface Score {
	pass: boolean;
	subscores: Subscores;
}

/** True when a document host's reply leaks browser-only vocabulary, or the chrome
 * reply leaks document-only vocabulary. */
function hasCrossHostLeak(host: HostId, reply: string): boolean {
	return host === "chrome" ? DOC_ONLY_RE.test(reply) : BROWSER_ONLY_RE.test(reply);
}

/** Score one reply for one host + probe. PASS = all four subscores true.
 * `probe` is the question text — identity_kept is only scored on identity probes
 * ("who are you?"); task probes default to true (no_pushback covers disclaimers). */
export function score(host: HostId, replyText: string, probe?: string): Score {
	const isIdentityProbe = probe ? IDENTITY_PROBE_RE.test(probe) : true;
	const subscores: Subscores = {
		identity_kept: isIdentityProbe ? IDENTITY_RE.test(replyText) : true,
		app_adopted: APP_LEXICON[host].test(replyText),
		no_pushback: !PUSHBACK_RE.test(replyText),
		no_cross_host_leak: !hasCrossHostLeak(host, replyText),
	};
	const pass =
		subscores.identity_kept && subscores.app_adopted && subscores.no_pushback && subscores.no_cross_host_leak;
	return { pass, subscores };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export interface SubscoreRates {
	identity_kept: number;
	app_adopted: number;
	no_pushback: number;
	no_cross_host_leak: number;
}

export interface HostResult {
	host: HostId;
	samples: number;
	passing: number;
	pass_rate: number;
	subscoreRates: SubscoreRates;
}

export type HostBehaviorResult = { [K in HostId]?: HostResult };

const rate = (n: number, total: number): number => (total === 0 ? 0 : n / total);

/** Aggregate a host's per-sample scores into pass_rate + per-subscore rates. */
export function aggregateHost(host: HostId, scores: Score[]): HostResult {
	const samples = scores.length;
	const passing = scores.filter(s => s.pass).length;
	const count = (k: keyof Subscores): number => scores.filter(s => s.subscores[k]).length;
	return {
		host,
		samples,
		passing,
		pass_rate: rate(passing, samples),
		subscoreRates: {
			identity_kept: rate(count("identity_kept"), samples),
			app_adopted: rate(count("app_adopted"), samples),
			no_pushback: rate(count("no_pushback"), samples),
			no_cross_host_leak: rate(count("no_cross_host_leak"), samples),
		},
	};
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export interface GateOptions {
	/** Minimum acceptable per-host pass_rate. */
	minPassRate: number;
}

export const DEFAULT_GATE: GateOptions = { minPassRate: 0.8 };

/**
 * The `--check` gate: FAIL if ANY host's pass_rate < minPassRate, OR any host's
 * identity_kept / no_pushback subscore rate is not a perfect 1.0. The identity +
 * no-pushback perfection requirement is the crux of issue #2201 (no Office
 * pushback, never lose the F5 identity).
 */
export function checkGate(
	result: HostBehaviorResult,
	opts: GateOptions = DEFAULT_GATE,
): {
	ok: boolean;
	failures: string[];
} {
	const failures: string[] = [];
	for (const host of HOSTS) {
		const r = result[host];
		if (!r) continue;
		if (r.pass_rate < opts.minPassRate) {
			failures.push(`${host}: pass_rate ${r.pass_rate.toFixed(3)} < ${opts.minPassRate}`);
		}
		if (r.subscoreRates.identity_kept < 1) {
			failures.push(`${host}: identity_kept ${r.subscoreRates.identity_kept.toFixed(3)} < 1.0`);
		}
		if (r.subscoreRates.no_pushback < 1) {
			failures.push(`${host}: no_pushback ${r.subscoreRates.no_pushback.toFixed(3)} < 1.0`);
		}
	}
	return { ok: failures.length === 0, failures };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const pad = (s: string, n: number): string => s.padEnd(n);
const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

/** A stdout summary table (one row per host) for the live driver. */
export function formatTable(result: HostBehaviorResult): string {
	const lines: string[] = [];
	lines.push(
		`${pad("host", 12)}${pad("pass", 10)}${pad("identity", 10)}${pad("app", 8)}${pad("noPush", 8)}${pad("noLeak", 8)}`,
	);
	lines.push("-".repeat(56));
	for (const host of HOSTS) {
		const r = result[host];
		if (!r) continue;
		lines.push(
			`${pad(host, 12)}${pad(`${r.passing}/${r.samples}`, 10)}${pad(pct(r.subscoreRates.identity_kept), 10)}` +
				`${pad(pct(r.subscoreRates.app_adopted), 8)}${pad(pct(r.subscoreRates.no_pushback), 8)}${pad(pct(r.subscoreRates.no_cross_host_leak), 8)}`,
		);
	}
	return lines.join("\n");
}
