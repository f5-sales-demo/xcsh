/**
 * Pure, IO-free logic for the multi-resource performance benchmark. No Chrome,
 * no network — unit-tested in multi-resource-report.test.ts and safe to import
 * in CI. The live driver (multi-resource-bench.ts) supplies the raw inputs
 * (wall-clock timings + captured DOM rows + API statuses); everything here is a
 * deterministic function of those inputs.
 *
 * Mirrors the hermetic-vs-live split of bench/ttft.ts + bench/ttft-report.ts,
 * and reuses `median` and the harness's `resourceNames` rather than re-deriving.
 */
import { median } from "../../../bench/ttft-report";
import { type ResourceNames, resourceNames } from "../harness/panel-harness";

/** The three ways to drive a multi-resource build we compare. */
export type TechniqueId = "workflow_directed" | "free_plan" | "sequential";

/** Short keys for the resources a technique creates. */
export type ResourceKey = "hc" | "pool" | "lb" | "waf";

/** F5 XC config-API collection for each resource key (mirrors staging-crud paths). */
const RESOURCE_COLLECTION: Record<ResourceKey, string> = {
	hc: "healthchecks",
	pool: "origin_pools",
	lb: "http_loadbalancers",
	waf: "app_firewalls",
};

/** A resource a technique is expected to create, with its collection + concrete name. */
export interface ExpectedResource {
	key: ResourceKey;
	resource: string;
	name: string;
}

/** {app_name}-scoped names for the workflow-directed technique. The waap-full-stack-demo
 * workflow names its resources `{app_name}-pool` / `-waf` / `-lb` (no standalone named
 * health check), so this technique's expected set is 3, not 4. */
export interface WorkflowNames {
	appName: string;
	pool: string;
	waf: string;
	lb: string;
}

export function workflowNames(suffix: string): WorkflowNames {
	const appName = `e2e-wf-${suffix}`;
	return { appName, pool: `${appName}-pool`, waf: `${appName}-waf`, lb: `${appName}-lb` };
}

/** Params the waap-full-stack-demo workflow needs beyond app_name. */
export interface WorkflowSpec {
	namespace: string;
	domain: string;
	/** Origin server — a HOSTNAME (the workflow's DNS-name field rejects raw IPs). */
	originServer: string;
	originPort: number;
	wafMode?: string;
}

// ── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Byte-equal to the multi-resource prompt in extension-panel-e2e.test.ts:165-169.
 * The benchmark's free-plan technique must measure the SAME prompt the live e2e
 * test uses; a test asserts this equality so the two never drift.
 */
export function freePlanPrompt(names: ResourceNames): string {
	return (
		`create an http load balancer named ${names.lb} ` +
		`with an origin pool named ${names.pool} with a dns member pointing to httpbin.org ` +
		`with a health check named ${names.hc} with an http path of /healthz ` +
		`and apply an app firewall named ${names.waf} on the load balancer`
	);
}

/**
 * Steer the model to call `catalog_workflow_runner` with the pre-defined
 * `waap-full-stack-demo` workflow (dependency chain baked in → ~3s first token)
 * instead of re-deriving the graph itself (>120s extended thinking).
 */
export function workflowDirectedPrompt(wf: WorkflowNames, spec: WorkflowSpec): string {
	const wafMode = spec.wafMode ?? "Blocking";
	return (
		`Use the "waap-full-stack-demo" workflow to build a full WAAP stack. ` +
		`Call the catalog_workflow_runner tool directly with these params: ` +
		`namespace ${spec.namespace}, app_name ${wf.appName}, domain ${spec.domain}, ` +
		`origin_server ${spec.originServer}, origin_port ${spec.originPort}, waf_mode ${wafMode}. ` +
		`Do not re-plan the dependencies — run the workflow.`
	);
}

/** Four dependency-ordered single-resource prompts: health check → origin pool →
 * app firewall → load balancer (each references the ones it depends on by name). */
export function sequentialPrompts(names: ResourceNames): string[] {
	return [
		`create a health check named ${names.hc} with an http path of /healthz`,
		`create an origin pool named ${names.pool} with a dns member pointing to httpbin.org ` +
			`with a health check named ${names.hc}`,
		`create an app firewall named ${names.waf}`,
		`create an http load balancer named ${names.lb} with an origin pool named ${names.pool} ` +
			`and apply an app firewall named ${names.waf} on the load balancer`,
	];
}

// ── Expected-resource descriptors ────────────────────────────────────────────

/** The resource keys a technique is expected to create. Workflow-directed omits a
 * standalone health check (the workflow embeds it in the pool). */
export function techniqueResourceKeys(technique: TechniqueId): ResourceKey[] {
	return technique === "workflow_directed" ? ["pool", "waf", "lb"] : ["hc", "pool", "lb", "waf"];
}

function nameForKey(technique: TechniqueId, suffix: string, key: ResourceKey): string {
	if (technique === "workflow_directed") {
		const wf = workflowNames(suffix);
		return key === "pool" ? wf.pool : key === "waf" ? wf.waf : wf.lb;
	}
	const n = resourceNames(suffix);
	return key === "hc" ? n.hc : key === "pool" ? n.pool : key === "lb" ? n.lb : n.waf;
}

export function expectedResources(technique: TechniqueId, suffix: string): ExpectedResource[] {
	return techniqueResourceKeys(technique).map(key => ({
		key,
		resource: RESOURCE_COLLECTION[key],
		name: nameForKey(technique, suffix, key),
	}));
}

/** GET-status map → per-key booleans over a technique's expected set (200 = created). */
export function resourcesCreated(
	statuses: Record<string, number>,
	expected: ExpectedResource[],
): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const e of expected) out[e.key] = statuses[e.key] === 200;
	return out;
}

// ── DOM row parsing ──────────────────────────────────────────────────────────

/** A row captured from the panel's `#messages` list by the browser-side observer. */
export interface TimelineEvent {
	/** Milliseconds since the send click (observer base). */
	t_ms: number;
	/** The gutter element's class string, e.g. "gutter g-tool-ok". */
	className: string;
	/** The row's `.body` text content. */
	body: string;
}

export interface ToolRow {
	toolName: string;
	ok: boolean;
	skipped: boolean;
}

/** Parse a tool-notice row (`g-tool-ok`/`g-tool-err`, body `"{tool}: ✓/✗ {text}"`).
 * Returns null for any non-tool row (assistant, error, user, thinking). */
export function classifyToolRow(className: string, body: string): ToolRow | null {
	const ok = /\bg-tool-ok\b/.test(className);
	const err = /\bg-tool-err\b/.test(className);
	if (!ok && !err) return null;
	const m = /^(.+?):\s*[✓✗]\s*([\s\S]*)$/.exec(body);
	const toolName = m ? m[1].trim() : body.trim();
	const text = m ? m[2] : "";
	return { toolName, ok, skipped: /\bskip/i.test(text) };
}

/** True for a real error row — excludes the transient "starting… / resend" self-heal
 * flash (which the harness's sendPrompt also text-matches away). */
export function isErrorRow(className: string, body: string): boolean {
	return /\bg-error\b/.test(className) && !/starting|resend/i.test(body);
}

// ── Per-run metrics ──────────────────────────────────────────────────────────

export interface ToolTimelineEntry {
	t_ms: number;
	toolName: string;
	ok: boolean;
}

export interface RunMetrics {
	technique: TechniqueId;
	run: number;
	ttft_ms: number;
	total_ms: number;
	tool_count: number;
	annotate_drawn: number;
	annotate_skipped: number;
	resources_created: Record<string, boolean>;
	errors: string[];
	timeline: ToolTimelineEntry[];
}

export interface RunHeadline {
	technique: TechniqueId;
	run: number;
	/** Wall-clock send → first token (`#stop` appears). */
	ttftMs: number;
	/** Wall-clock send → turn done (`#send` back, `#stop` gone). */
	totalMs: number;
	/** GET status per resource key, from the post-turn API poll. */
	statuses: Record<string, number>;
}

/** Reduce captured DOM events + wall-clock headline + API statuses into one run's metrics. */
export function reduceTimeline(events: TimelineEvent[], h: RunHeadline): RunMetrics {
	const timeline: ToolTimelineEntry[] = [];
	const errors: string[] = [];
	let tool_count = 0;
	let annotate_drawn = 0;
	let annotate_skipped = 0;

	for (const ev of events) {
		const tool = classifyToolRow(ev.className, ev.body);
		if (tool) {
			tool_count++;
			timeline.push({ t_ms: ev.t_ms, toolName: tool.toolName, ok: tool.ok });
			if (tool.toolName === "annotate") {
				if (tool.skipped) annotate_skipped++;
				else annotate_drawn++;
			}
			continue;
		}
		if (isErrorRow(ev.className, ev.body)) errors.push(ev.body);
	}

	const resources_created: Record<string, boolean> = {};
	for (const key of techniqueResourceKeys(h.technique)) resources_created[key] = h.statuses[key] === 200;

	return {
		technique: h.technique,
		run: h.run,
		ttft_ms: h.ttftMs,
		total_ms: h.totalMs,
		tool_count,
		annotate_drawn,
		annotate_skipped,
		resources_created,
		errors,
		timeline,
	};
}

// ── Aggregation across runs ──────────────────────────────────────────────────

export interface TechniqueResult {
	technique: TechniqueId;
	runs: number;
	ttft_ms: number;
	total_ms: number;
	tool_count: number;
	annotate_drawn: number;
	annotate_skipped: number;
	/** How many of the N runs created each resource key. */
	resources_created: Record<string, number>;
	/** Median per-run count of created resources — the robust reliability signal. */
	resource_count_median: number;
	errors_count: number;
}

export type MultiBenchResult = { [K in TechniqueId]?: TechniqueResult };

/** The full JSON artifact written by `--out`: every run plus the aggregate. */
export interface BenchResultFile {
	generatedSuffix: string;
	runs: number;
	perRun: RunMetrics[];
	aggregate: MultiBenchResult;
}

/** Median every numeric metric across a technique's runs; tally resource creation. */
export function aggregate(runs: RunMetrics[]): TechniqueResult {
	const pick = (f: (r: RunMetrics) => number): number => median(runs.map(f));
	const keys = new Set<string>();
	for (const r of runs) for (const k of Object.keys(r.resources_created)) keys.add(k);
	const resources_created: Record<string, number> = {};
	for (const k of keys) resources_created[k] = runs.filter(r => r.resources_created[k]).length;
	const resource_count_median = median(runs.map(r => Object.values(r.resources_created).filter(Boolean).length));
	return {
		technique: runs[0].technique,
		runs: runs.length,
		ttft_ms: pick(r => r.ttft_ms),
		total_ms: pick(r => r.total_ms),
		tool_count: pick(r => r.tool_count),
		annotate_drawn: pick(r => r.annotate_drawn),
		annotate_skipped: pick(r => r.annotate_skipped),
		resources_created,
		resource_count_median,
		errors_count: pick(r => r.errors.length),
	};
}

// ── Baseline comparison ──────────────────────────────────────────────────────

export interface TimingDelta {
	technique: TechniqueId;
	metric: string;
	baseline: number;
	current: number;
	deltaPct: number;
	/** Exceeds both tolerances — shown emphasised, but NEVER gates the exit code. */
	flagged: boolean;
}

export interface CompareOptions {
	tolerancePct: number;
	minAbsMs: number;
}

const TIMING_METRICS = ["ttft_ms", "total_ms", "tool_count"] as const;

/**
 * Compare current medians to a baseline. Timing deltas are REPORT-ONLY (provider
 * latency dominates and is un-optimizable, so gating on it false-positives). The
 * only gating signal is `resourceRegressions`: a technique that creates fewer
 * resources than baseline — surfaced for the opt-in `--gate-resources` exit code.
 */
export function compareToBaseline(
	base: MultiBenchResult,
	cur: MultiBenchResult,
	opts: CompareOptions,
): { timingDeltas: TimingDelta[]; resourceRegressions: string[] } {
	const timingDeltas: TimingDelta[] = [];
	const resourceRegressions: string[] = [];
	for (const technique of Object.keys(cur) as TechniqueId[]) {
		const b = base[technique];
		const c = cur[technique];
		if (!b || !c) continue;
		for (const metric of TIMING_METRICS) {
			const bv = b[metric];
			const cv = c[metric];
			const deltaPct = bv === 0 ? (cv > 0 ? Number.POSITIVE_INFINITY : 0) : ((cv - bv) / bv) * 100;
			const flagged = deltaPct > opts.tolerancePct && cv - bv > opts.minAbsMs;
			timingDeltas.push({ technique, metric, baseline: bv, current: cv, deltaPct, flagged });
		}
		if (c.resource_count_median < b.resource_count_median) {
			resourceRegressions.push(`${technique}: resources ${b.resource_count_median} → ${c.resource_count_median}`);
		}
	}
	return { timingDeltas, resourceRegressions };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const TECHNIQUE_ORDER: TechniqueId[] = ["workflow_directed", "free_plan", "sequential"];

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (n: number): string => (Number.isFinite(n) ? n.toFixed(0) : "—");

/** A stdout comparison table (one row per technique), optionally with a Δ-vs-baseline block. */
export function formatTable(cur: MultiBenchResult, base?: MultiBenchResult): string {
	const lines: string[] = [];
	lines.push(
		`${pad("technique", 20)}${pad("TTFT(ms)", 10)}${pad("total(ms)", 11)}${pad("tools", 7)}` +
			`${pad("annot(d/s)", 12)}${pad("res(med)", 10)}${pad("errors", 7)}`,
	);
	lines.push("-".repeat(77));
	for (const t of TECHNIQUE_ORDER) {
		const r = cur[t];
		if (!r) continue;
		lines.push(
			`${pad(t, 20)}${pad(num(r.ttft_ms), 10)}${pad(num(r.total_ms), 11)}${pad(num(r.tool_count), 7)}` +
				`${pad(`${r.annotate_drawn}/${r.annotate_skipped}`, 12)}${pad(num(r.resource_count_median), 10)}${pad(num(r.errors_count), 7)}`,
		);
	}
	if (base) {
		const { timingDeltas, resourceRegressions } = compareToBaseline(base, cur, { tolerancePct: 30, minAbsMs: 15 });
		lines.push("");
		lines.push("=== Δ vs baseline (timing report-only; resources gate) ===");
		for (const d of timingDeltas) {
			const sign = d.deltaPct >= 0 ? "+" : "";
			const mark = d.flagged ? "  ⚠" : "";
			lines.push(
				`  ${pad(`${d.technique}.${d.metric}`, 32)} ${num(d.baseline)} → ${num(d.current)} (${sign}${d.deltaPct.toFixed(1)}%)${mark}`,
			);
		}
		if (resourceRegressions.length) {
			lines.push("");
			lines.push(`  RESOURCE REGRESSION: ${resourceRegressions.join("; ")}`);
		}
	}
	return lines.join("\n");
}
