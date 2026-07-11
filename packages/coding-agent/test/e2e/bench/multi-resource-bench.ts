/**
 * LIVE multi-resource performance benchmark — drives the REAL xcsh side panel to
 * build a multi-resource F5 XC config three different ways and measures each:
 * TTFT (send → first token) → console automation → completion, plus tool counts,
 * annotate overhead, per-tool timeline, created resources, and errors.
 *
 * Model + lifecycle mirror the panel E2E test (connect() to a real Chrome, operator
 * opens the native side panel once). Pure metric logic lives in multi-resource-report.ts
 * (unit-tested, CI-safe); this file is the live driver and NEVER runs in CI:
 *   - it is not a *.test.ts, so `bun test` never picks it up;
 *   - `puppeteer` loads only via the harness's dynamic import, so it is import-safe
 *     for lint/typecheck;
 *   - it self-gates on `canRunLive` and exits early without creds / on CI.
 *
 * Prerequisites (same as extension-panel-e2e.test.ts): extension built with the dev
 * key, native host installed (`xcsh chrome setup`), VPN up, and — when the Chrome
 * window opens — click the xcsh toolbar icon to open the panel.
 *
 * Run:
 *   XCSH_STAGING_API_URL=https://nferreira.staging.volterra.us \
 *   XCSH_STAGING_API_TOKEN=<token> \
 *   dana@example.com \
 *   XCSH_STAGING_PASSWORD=<pw> \
 *   bun test/e2e/bench/multi-resource-bench.ts [--runs 3] [--only workflow_directed]
 *        [--out results.json] [--check] [--update-baseline] [--gate-resources]
 *        [--tolerance 30] [--min-abs-ms 15]
 *        [--settle-ms 12000] [--verify-hard-ms 420000] [--verify-grace-ms 120000]
 *        [--turn-timeout-ms 600000]
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "puppeteer";
import {
	attachDiagnostics,
	awaitTurnStart,
	type ChromeSession,
	canRunLive,
	findPanel,
	launchAndConnect,
	openConsoleAndLogin,
	resetConversation,
	resourceNames,
	resourcePath,
	sendPrompt,
	setMode,
	waitForPanelReady,
	waitForTurnDone,
} from "../harness/panel-harness";
import {
	aggregate,
	type BenchResultFile,
	compareToBaseline,
	type ExpectedResource,
	expectedResources,
	formatTable,
	freePlanPrompt,
	type MultiBenchResult,
	type RunMetrics,
	reduceTimeline,
	sequentialPrompts,
	type TechniqueId,
	type TimelineEvent,
	workflowDirectedPrompt,
	workflowNames,
} from "./multi-resource-report";

// ── CLI parsing (mirrors bench/ttft.ts) ──────────────────────────────────────
function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? (process.argv[i + 1] ?? "") : undefined;
}
function flag(name: string): boolean {
	return process.argv.includes(name);
}
function numArg(name: string, def: number): number {
	const v = arg(name);
	if (v === undefined) return def;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : def;
}

const RUNS = numArg("--runs", 3);
const TOLERANCE = numArg("--tolerance", 30);
const MIN_ABS_MS = numArg("--min-abs-ms", 15);
const ONLY = arg("--only") as TechniqueId | undefined;
const OUT = arg("--out");
const GATE_RESOURCES = flag("--gate-resources");
const DO_CHECK = flag("--check");
const DO_UPDATE = flag("--update-baseline");

const ALL_TECHNIQUES: TechniqueId[] = ["workflow_directed", "free_plan", "sequential"];
if (ONLY && !ALL_TECHNIQUES.includes(ONLY)) {
	console.error(`--only must be one of ${ALL_TECHNIQUES.join(", ")} (got "${ONLY}")`);
	process.exit(2);
}
const TECHNIQUES = ONLY ? [ONLY] : ALL_TECHNIQUES;

// ── Env / gate ───────────────────────────────────────────────────────────────
const API_URL = process.env.XCSH_STAGING_API_URL;
const API_TOKEN = process.env.XCSH_STAGING_API_TOKEN;
const USERNAME = process.env.XCSH_STAGING_USERNAME;
const PASSWORD = process.env.XCSH_STAGING_PASSWORD;
const NS = process.env.XCSH_STAGING_NAMESPACE ?? "r-mordasiewicz";
const CONSOLE_URL =
	process.env.XCSH_STAGING_CONSOLE_URL ??
	`${API_URL}/web/workspaces/web-app-and-api-protection/namespaces/${NS}/manage/load_balancers/http_loadbalancers`;
const PROFILE_DIR = process.env.XCSH_E2E_PROFILE ?? join(tmpdir(), "xcsh-e2e-profile");
const ARTIFACTS = resolve(import.meta.dir, "../.artifacts");
const BASELINE = resolve(import.meta.dir, "multi-resource-baseline.json");
const SUFFIX = Date.now().toString(36).slice(-6);

// Per-turn deadline: workflow-directed multi-resource completes in ~325s; give headroom.
const TURN_TIMEOUT_MS = numArg("--turn-timeout-ms", 600_000);
// Debounce before a turn counts as terminal — rides the false-idle gaps between the
// preamble text and the first tool call, and between tool steps (see waitForTurnDone).
const SETTLE_MS = numArg("--settle-ms", 12_000);
// Authoritative resource-verify hard window (DECOUPLED from turn-done). workflow-directed
// creates ~3 resources over ~325s, so this must clear that plus margin.
const VERIFY_HARD_MS = numArg("--verify-hard-ms", 420_000);
// Once the turns have settled, abandon verification if no NEW resource has appeared for
// this long — bounds true-zero / stalled runs (e.g. free-plan) without a fixed long wait.
const VERIFY_GRACE_MS = numArg("--verify-grace-ms", 120_000);
// Deletion order honours the F5 XC reference chain (LB → WAF → pool → health check).
const CLEANUP_COLLECTION_ORDER = ["http_loadbalancers", "app_firewalls", "origin_pools", "healthchecks"];

const AUTH = { Authorization: `APIToken ${API_TOKEN}` };
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const log = (msg: string): void => console.log(`[bench] ${msg}`);

async function api(method: string, path: string): Promise<{ status: number }> {
	const res = await fetch(`${API_URL}${path}`, { method, headers: AUTH }).catch(() => null);
	return { status: res?.status ?? 0 };
}

/**
 * AUTHORITATIVE workability signal — poll ALL expected resources against the config
 * API, DECOUPLED from the panel's turn-done detection (which can false-complete on a
 * multi-step tool turn). Designed to run CONCURRENTLY with the turn: it issues only
 * `fetch` calls (no CDP), so it never contends with the turn's CDP polling. Resolves on:
 *   - every expected resource 200 (success — records `completedAt`), or
 *   - the turns have SETTLED and no NEW resource has appeared for `graceAfterSettleMs`
 *     (bounds true-zero / stalled runs like free-plan), or
 *   - the hard window elapses (backstop).
 *
 * Polling all resources under ONE shared deadline (not sequentially) means a failed run
 * never waits the full window per resource.
 */
async function verifyResources(
	expected: ExpectedResource[],
	opts: { hardTimeoutMs: number; graceAfterSettleMs: number; settled: () => boolean },
): Promise<{ statuses: Record<string, number>; completedAt: number | null }> {
	const statuses: Record<string, number> = {};
	for (const e of expected) statuses[e.key] = 0;
	const deadline = Date.now() + opts.hardTimeoutMs;
	let createdCount = 0;
	let lastProgressAt = Date.now();
	while (Date.now() < deadline) {
		await Promise.all(
			expected.map(async e => {
				if (statuses[e.key] !== 200)
					statuses[e.key] = (await api("GET", resourcePath(NS, e.resource, e.name))).status;
			}),
		);
		const now = expected.filter(e => statuses[e.key] === 200).length;
		if (now > createdCount) {
			createdCount = now;
			lastProgressAt = Date.now();
		}
		if (now === expected.length) return { statuses, completedAt: Date.now() };
		// Give up ONLY once the turns have settled — a slow-but-working turn (e.g. a long
		// think between tool calls) must not be abandoned before it has finished.
		if (opts.settled() && Date.now() - lastProgressAt >= opts.graceAfterSettleMs) break;
		await sleep(5000);
	}
	return { statuses, completedAt: null };
}

// ── Browser-side timeline observer ───────────────────────────────────────────

/**
 * Install a MutationObserver on `#messages` that stamps each added row (class +
 * body text) relative to now (= just before the send). Passive capture — read back
 * once after the turn is done, so it never races waitForTurnDone's CDP polling.
 */
async function injectTimelineObserver(panel: Page): Promise<void> {
	// Structural DOM types only (no DOM lib in this package's tsconfig; mirrors the
	// harness's `globalThis as unknown as {…}` pattern for page.evaluate callbacks).
	await panel.evaluate(() => {
		type Ev = { t_ms: number; className: string; body: string };
		type El = {
			className?: string;
			nodeType: number;
			innerText?: string;
			textContent?: string | null;
			matches?(sel: string): boolean;
			querySelector(sel: string): El | null;
			querySelectorAll?(sel: string): ArrayLike<El>;
		};
		type MutRec = { addedNodes: ArrayLike<El> };
		type Obs = { observe(target: El, opts: { childList: boolean; subtree: boolean }): void; disconnect(): void };
		const g = globalThis as unknown as {
			__xcshBench?: { base: number; events: Ev[]; obs?: Obs };
			document: { querySelector(sel: string): El | null };
			performance: { now(): number };
			MutationObserver: new (cb: (muts: MutRec[]) => void) => Obs;
		};
		g.__xcshBench?.obs?.disconnect();
		const base = g.performance.now();
		const events: Ev[] = [];
		const record = (node: El): void => {
			const rows = node.matches?.(".row") ? [node] : Array.from(node.querySelectorAll?.(".row") ?? []);
			for (const row of rows) {
				const gutter = row.querySelector(".gutter");
				const body = row.querySelector(".body");
				events.push({
					t_ms: g.performance.now() - base,
					className: gutter?.className ?? "",
					// `||` (not `??`): innerText can be "" for a not-yet-laid-out node → fall back to textContent.
					body: body?.innerText || body?.textContent || "",
				});
			}
		};
		const messages = g.document.querySelector("#messages");
		const obs = new g.MutationObserver((muts: MutRec[]) => {
			for (const mut of muts)
				for (const n of Array.from(mut.addedNodes)) {
					if (n.nodeType === 1) record(n);
				}
		});
		if (messages) obs.observe(messages, { childList: true, subtree: true });
		g.__xcshBench = { base, events, obs };
	});
}

async function readTimeline(panel: Page): Promise<TimelineEvent[]> {
	return panel.evaluate(() => {
		const g = globalThis as unknown as { __xcshBench?: { events: TimelineEvent[] } };
		return g.__xcshBench?.events ?? [];
	}) as Promise<TimelineEvent[]>;
}

// ── One measured run of a technique ──────────────────────────────────────────

// currentSuffix is set per run so the prompt builders + expectedResources agree.
let currentSuffix = SUFFIX;

function techniquePrompts(technique: TechniqueId): string[] {
	if (technique === "workflow_directed") {
		return [
			workflowDirectedPrompt(workflowNames(currentSuffix), {
				namespace: NS,
				domain: `${currentSuffix}.example.com`,
				originServer: "httpbin.org",
				originPort: 80,
			}),
		];
	}
	// free_plan / sequential use the harness's resourceNames (byte-equal to the e2e prompt).
	const names = resourceNames(currentSuffix);
	return technique === "sequential" ? sequentialPrompts(names) : [freePlanPrompt(names)];
}

async function runTechnique(panel: Page, technique: TechniqueId, run: number): Promise<RunMetrics> {
	const prompts = techniquePrompts(technique);
	await injectTimelineObserver(panel);
	const tStart = Date.now();

	// Send the first prompt and time ONLY the send→first-token window, excluding the
	// per-char type() cost (a ~450-char prompt would otherwise inflate TTFT and bias the
	// cross-technique comparison). Type untimed, then time the click→turn-start window.
	await panel.type("#input", prompts[0]);
	const sendStart = Date.now();
	await panel.click("#send");
	await awaitTurnStart(panel);
	const ttftMs = Date.now() - sendStart;

	// Drive the turn(s) to completion CONCURRENTLY with the authoritative API verify.
	// The drive sequences the sequential technique's remaining prompts, each gated on a
	// DEBOUNCED turn-done; it is the only CDP user here (verify is fetch-only), so the two
	// never race. `settled` flips true once every prompt's turn has settled and gates the
	// verify's no-progress early-out, so a slow-but-working turn is never abandoned early.
	let settled = false;
	const drive = (async () => {
		await waitForTurnDone(panel, TURN_TIMEOUT_MS, SETTLE_MS).catch(() => {});
		for (let i = 1; i < prompts.length; i++) {
			await sendPrompt(panel, prompts[i]).catch(() => {});
			await waitForTurnDone(panel, TURN_TIMEOUT_MS, SETTLE_MS).catch(() => {});
		}
	})().finally(() => {
		settled = true;
	});

	const expected = expectedResources(technique, currentSuffix);
	const { statuses, completedAt } = await verifyResources(expected, {
		hardTimeoutMs: VERIFY_HARD_MS,
		graceAfterSettleMs: VERIFY_GRACE_MS,
		settled: () => settled,
	});
	await drive; // bounded by TURN_TIMEOUT_MS + never rejects; ensures no stray CDP work outlives the run.

	// total_ms = send → all-resources-created (the real "multi-resource completion");
	// falls back to now when the run never completed (itself a failed-run data point).
	const totalMs = (completedAt ?? Date.now()) - tStart;
	// Read the passive timeline LAST so it captures every tool row — including any that
	// landed after a (possibly early) turn-done.
	const events = await readTimeline(panel);
	return reduceTimeline(events, { technique, run, ttftMs, totalMs, statuses });
}

/** Fresh conversation for an independent measurement: reset (except the very first
 * turn), wait ready, set execution mode, and warm the worker with a trivial turn
 * (a reset forces a slow re-provision, so the measured turn should run warm). */
async function prepareFreshTurn(browser: Browser, panelRef: { panel: Page }, isFirst: boolean): Promise<void> {
	if (!isFirst) panelRef.panel = await resetConversation(browser);
	await waitForPanelReady(panelRef.panel);
	await setMode(panelRef.panel, "configuration");
	// Warm the worker with a trivial turn so the MEASURED turn runs warm. A warm-up
	// hiccup (idle-reap mid-warm, a transient) must NOT abort the run — the measured
	// turn re-warms and awaitTurnStart rides the "starting… / resend" self-heal.
	try {
		await sendPrompt(panelRef.panel, "what page is this?");
		await waitForTurnDone(panelRef.panel, 120_000, SETTLE_MS);
	} catch (e) {
		log(`warm-up turn hiccup (non-fatal): ${String(e)}`);
	}
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup(created: ExpectedResource[]): Promise<void> {
	const ordered = [...created].sort(
		(a, b) => CLEANUP_COLLECTION_ORDER.indexOf(a.resource) - CLEANUP_COLLECTION_ORDER.indexOf(b.resource),
	);
	for (const e of ordered) await api("DELETE", resourcePath(NS, e.resource, e.name)).catch(() => {});
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
	if (!canRunLive(process.env)) {
		console.error(
			"multi-resource-bench: live gate not met (needs XCSH_STAGING_API_URL/API_TOKEN/USERNAME/PASSWORD and not CI). Skipping.",
		);
		process.exit(0);
	}
	fs.mkdirSync(PROFILE_DIR, { recursive: true });
	fs.mkdirSync(ARTIFACTS, { recursive: true });

	let session: ChromeSession | undefined;
	const created: ExpectedResource[] = [];
	const runsByTechnique = new Map<TechniqueId, RunMetrics[]>();

	try {
		session = await launchAndConnect(PROFILE_DIR, { consoleUrl: CONSOLE_URL, port: 9222 });
		await attachDiagnostics(session.browser, join(ARTIFACTS, `bench-sw-${SUFFIX}.log`));
		await openConsoleAndLogin(session.browser, {
			consoleUrl: CONSOLE_URL,
			username: USERNAME as string,
			password: PASSWORD as string,
			onLoginRequired: () => log("⚠️  Log in to staging in the open Chrome window (co-drive)…"),
		});
		const panelRef = {
			panel: await findPanel(session.browser, {
				onOpenRequired: () => log("👉 Click the xcsh toolbar icon to open the side panel."),
			}),
		};

		let first = true;
		for (const technique of TECHNIQUES) {
			const samples: RunMetrics[] = [];
			// Each run gets a fresh conversation + its own warm-up turn (in prepareFreshTurn),
			// so no separate discarded warm-up run is needed.
			for (let run = 1; run <= RUNS; run++) {
				await prepareFreshTurn(session.browser, panelRef, first);
				first = false;
				currentSuffix = `${SUFFIX}${technique[0]}${run}`;
				// Track expected resources for cleanup BEFORE the run, so a partial-then-throw
				// run still gets its objects deleted in the finally.
				created.push(...expectedResources(technique, currentSuffix));
				log(`${technique}: run ${run}/${RUNS} (suffix ${currentSuffix})…`);
				const runStart = Date.now();
				let m: RunMetrics;
				try {
					m = await runTechnique(panelRef.panel, technique, run);
				} catch (e) {
					// free-plan is EXPECTED to sometimes abort/time out — record it as a failed
					// run (which is itself a data point) and keep the benchmark going.
					m = {
						technique,
						run,
						ttft_ms: 0,
						total_ms: Date.now() - runStart,
						tool_count: 0,
						annotate_drawn: 0,
						annotate_skipped: 0,
						resources_created: Object.fromEntries(
							expectedResources(technique, currentSuffix).map(x => [x.key, false]),
						),
						errors: [`run threw: ${String(e)}`],
						timeline: [],
					};
					log(`${technique}: run ${run} THREW after ${m.total_ms}ms — recorded as a failed run`);
				}
				samples.push(m);
				log(
					`${technique}: run ${run} ttft=${m.ttft_ms}ms total=${m.total_ms}ms tools=${m.tool_count} ` +
						`resources=${Object.values(m.resources_created).filter(Boolean).length}/${Object.keys(m.resources_created).length} errors=${m.errors.length}`,
				);
			}
			runsByTechnique.set(technique, samples);
		}
	} finally {
		if (created.length) {
			log(`cleaning up ${created.length} resources…`);
			await cleanup(created).catch(() => {});
		}
		await session?.browser.disconnect().catch(() => {});
		session?.proc.kill();
	}

	// Aggregate + report.
	const result: MultiBenchResult = {};
	const perRun: RunMetrics[] = [];
	for (const [technique, samples] of runsByTechnique) {
		if (samples.length) result[technique] = aggregate(samples);
		perRun.push(...samples);
	}

	console.log(
		`\n${formatTable(result, fs.existsSync(BASELINE) && (DO_CHECK || DO_UPDATE) ? loadBaseline() : undefined)}`,
	);

	if (OUT) {
		const file: BenchResultFile = { generatedSuffix: SUFFIX, runs: RUNS, perRun, aggregate: result };
		fs.writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
		log(`wrote ${OUT}`);
	}

	if (DO_UPDATE) {
		fs.writeFileSync(BASELINE, `${JSON.stringify(result, null, 2)}\n`);
		log(`baseline updated → ${BASELINE}`);
		process.exit(0);
	}

	if (DO_CHECK) {
		if (!fs.existsSync(BASELINE)) {
			console.error("no baseline — run with --update-baseline first");
			process.exit(1);
		}
		const { resourceRegressions } = compareToBaseline(loadBaseline(), result, {
			tolerancePct: TOLERANCE,
			minAbsMs: MIN_ABS_MS,
		});
		if (GATE_RESOURCES && resourceRegressions.length) {
			console.error(`\nRESOURCE REGRESSION: ${resourceRegressions.join("; ")}`);
			process.exit(1);
		}
		console.log(
			GATE_RESOURCES
				? "\nOK — no resource regression"
				: "\n(report-only; pass --gate-resources to gate on resource drops)",
		);
	}
	process.exit(0);
}

function loadBaseline(): MultiBenchResult {
	return JSON.parse(fs.readFileSync(BASELINE, "utf8")) as MultiBenchResult;
}

await main();
