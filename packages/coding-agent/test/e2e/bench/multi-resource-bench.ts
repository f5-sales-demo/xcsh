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
 *   XCSH_STAGING_USERNAME=r.mordasiewicz@f5.com \
 *   XCSH_STAGING_PASSWORD=<pw> \
 *   bun test/e2e/bench/multi-resource-bench.ts [--runs 3] [--only workflow_directed]
 *        [--out results.json] [--check] [--update-baseline] [--gate-resources]
 *        [--tolerance 30] [--min-abs-ms 15]
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "puppeteer";
import {
	attachDiagnostics,
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
// Deletion order honours the F5 XC reference chain (LB → WAF → pool → health check).
const CLEANUP_COLLECTION_ORDER = ["http_loadbalancers", "app_firewalls", "origin_pools", "healthchecks"];

const AUTH = { Authorization: `APIToken ${API_TOKEN}` };
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const log = (msg: string): void => console.log(`[bench] ${msg}`);

async function api(method: string, path: string): Promise<{ status: number }> {
	const res = await fetch(`${API_URL}${path}`, { method, headers: AUTH }).catch(() => null);
	return { status: res?.status ?? 0 };
}

/** Poll GET until 200 or timeout — a resource appears shortly after the UI turn-done. */
async function apiGetOk(path: string, timeoutMs = 120_000): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let status = 0;
	while (Date.now() < deadline) {
		({ status } = await api("GET", path));
		if (status === 200) return status;
		await sleep(5000);
	}
	return status;
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
					body: body?.innerText ?? body?.textContent ?? "",
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
	let ttftMs = 0;
	for (let i = 0; i < prompts.length; i++) {
		const sendStart = Date.now();
		await sendPrompt(panel, prompts[i]);
		if (i === 0) ttftMs = Date.now() - sendStart; // send → first token (#stop appears)
		await waitForTurnDone(panel, TURN_TIMEOUT_MS);
	}
	const totalMs = Date.now() - tStart;
	const events = await readTimeline(panel);

	// Verify each expected resource via the config API (poll until 200 or timeout).
	const expected = expectedResources(technique, currentSuffix);
	const statuses: Record<string, number> = {};
	for (const e of expected) statuses[e.key] = await apiGetOk(resourcePath(NS, e.resource, e.name));

	return reduceTimeline(events, { technique, run, ttftMs, totalMs, statuses });
}

/** Fresh conversation for an independent measurement: reset (except the very first
 * turn), wait ready, set execution mode, and warm the worker with a trivial turn
 * (a reset forces a slow re-provision, so the measured turn should run warm). */
async function prepareFreshTurn(browser: Browser, panelRef: { panel: Page }, isFirst: boolean): Promise<void> {
	if (!isFirst) panelRef.panel = await resetConversation(browser);
	await waitForPanelReady(panelRef.panel);
	await setMode(panelRef.panel, "configuration");
	await sendPrompt(panelRef.panel, "what page is this?");
	await waitForTurnDone(panelRef.panel, 120_000);
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
			// run 0 is a discarded warm-up; runs 1..RUNS are measured (mirrors ttft.ts runs+1).
			for (let run = 0; run <= RUNS; run++) {
				await prepareFreshTurn(session.browser, panelRef, first);
				first = false;
				if (run === 0) {
					log(`${technique}: warm-up done (discarded)`);
					continue;
				}
				currentSuffix = `${SUFFIX}${technique[0]}${run}`;
				log(`${technique}: run ${run}/${RUNS} (suffix ${currentSuffix})…`);
				const m = await runTechnique(panelRef.panel, technique, run);
				samples.push(m);
				created.push(...expectedResources(technique, currentSuffix));
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
