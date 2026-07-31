/**
 * Hermetic unit tests for the pure logic of the multi-resource performance
 * benchmark. No Chrome, no creds, no network — these run in CI (bun test globs
 * *.test.ts across the package). The live driver (multi-resource-bench.ts) is
 * gated separately and never runs here.
 *
 * Run: bun test test/e2e/bench/multi-resource-report.test.ts
 */
import { describe, expect, it } from "bun:test";
import { resourceNames } from "../harness/panel-harness";
import {
	aggregate,
	classifyToolRow,
	compareToBaseline,
	expectedResources,
	formatTable,
	freePlanPrompt,
	isErrorRow,
	type MultiBenchResult,
	type RunMetrics,
	reduceTimeline,
	resourcesCreated,
	sequentialPrompts,
	type TimelineEvent,
	workflowDirectedPrompt,
	workflowNames,
} from "./multi-resource-report";

const NAMES = resourceNames("abc123");

describe("freePlanPrompt — byte-equal to the extension-panel-e2e multi-resource prompt", () => {
	it("matches the exact concatenation used by the live e2e test", () => {
		// Mirror of extension-panel-e2e.test.ts:165-169. If that prompt changes,
		// this test must change with it — the benchmark measures the SAME prompt.
		const expected =
			`create an http load balancer named ${NAMES.lb} ` +
			`with an origin pool named ${NAMES.pool} with a dns member pointing to httpbin.org ` +
			`with a health check named ${NAMES.hc} with an http path of /healthz ` +
			`and apply an app firewall named ${NAMES.waf} on the load balancer`;
		expect(freePlanPrompt(NAMES)).toBe(expected);
	});
});

describe("workflowDirectedPrompt — steers the model to call catalog_workflow_runner", () => {
	const wf = workflowNames("abc123");
	const prompt = workflowDirectedPrompt(wf, {
		namespace: "example-corp",
		domain: "app.example.com",
		originServer: "httpbin.org",
		originPort: 80,
	});
	it("directs catalog_workflow_runner to the demos/waap-full-stack workflow by resource+operation", () => {
		expect(prompt).toContain("catalog_workflow_runner");
		expect(prompt).toContain('resource "demos"');
		expect(prompt).toContain('operation "waap-full-stack"');
	});
	it("passes the workflow's required params (app_name, domain, origin_server, origin_port)", () => {
		expect(prompt).toContain(wf.appName);
		expect(prompt).toContain("app.example.com");
		expect(prompt).toContain("httpbin.org");
		expect(prompt).toContain("80");
	});
});

describe("sequentialPrompts — one dependency-ordered prompt per resource", () => {
	const prompts = sequentialPrompts(NAMES);
	it("yields four prompts", () => {
		expect(prompts).toHaveLength(4);
	});
	it("orders them health check → origin pool → app firewall → load balancer", () => {
		expect(prompts[0]).toContain(NAMES.hc);
		expect(prompts[1]).toContain(NAMES.pool);
		expect(prompts[2]).toContain(NAMES.waf);
		expect(prompts[3]).toContain(NAMES.lb);
	});
	it("references the pool's health check and the LB's pool + waf so the deps resolve", () => {
		expect(prompts[1]).toContain(NAMES.hc); // pool uses the health check
		expect(prompts[3]).toContain(NAMES.pool); // lb uses the pool
		expect(prompts[3]).toContain(NAMES.waf); // lb applies the waf
	});
});

describe("classifyToolRow — parse a #messages tool row into {toolName, ok, skipped}", () => {
	it("parses a successful tool row (g-tool-ok, ✓)", () => {
		expect(classifyToolRow("gutter g-tool-ok", "navigate: ✓ opened load balancers")).toEqual({
			toolName: "navigate",
			ok: true,
			skipped: false,
		});
	});
	it("parses a failed tool row (g-tool-err, ✗)", () => {
		expect(classifyToolRow("gutter g-tool-err", "fill: ✗ selector not found")).toEqual({
			toolName: "fill",
			ok: false,
			skipped: false,
		});
	});
	it("flags a skipped annotate as skipped (still ok)", () => {
		expect(classifyToolRow("gutter g-tool-ok", "annotate: ✓ skipped: explain mode off")).toEqual({
			toolName: "annotate",
			ok: true,
			skipped: true,
		});
	});
	it("returns null for a non-tool row (assistant / error / user)", () => {
		expect(classifyToolRow("gutter g-assistant", "here is what I did")).toBeNull();
		expect(classifyToolRow("gutter g-error", "Turn aborted.")).toBeNull();
		expect(classifyToolRow("gutter g-user", "create a load balancer")).toBeNull();
	});
});

describe("isErrorRow — an error row that isn't the transient starting/resend flash", () => {
	it("true for a real error", () => {
		expect(isErrorRow("gutter g-error", "Turn aborted.")).toBe(true);
	});
	it("false for the transient 'starting… resend' self-heal message", () => {
		expect(isErrorRow("gutter g-error", "xcsh is starting for this tab — one moment, then resend.")).toBe(false);
	});
	it("false for a non-error row", () => {
		expect(isErrorRow("gutter g-tool-ok", "navigate: ✓ done")).toBe(false);
	});
});

describe("expectedResources — per-technique expected resource set", () => {
	it("free_plan expects 4 resources (hc, pool, lb, waf) on the right collections", () => {
		const exp = expectedResources("free_plan", "abc123");
		expect(exp.map(e => e.key).sort()).toEqual(["hc", "lb", "pool", "waf"]);
		const byKey = Object.fromEntries(exp.map(e => [e.key, e]));
		expect(byKey.hc.resource).toBe("healthchecks");
		expect(byKey.pool.resource).toBe("origin_pools");
		expect(byKey.lb.resource).toBe("http_loadbalancers");
		expect(byKey.waf.resource).toBe("app_firewalls");
		expect(byKey.pool.name).toBe(NAMES.pool);
	});
	it("sequential expects the same 4 resources as free_plan", () => {
		expect(expectedResources("sequential", "abc123")).toEqual(expectedResources("free_plan", "abc123"));
	});
	it("workflow_directed expects only 3 (pool, waf, lb) with {app_name}- names", () => {
		const exp = expectedResources("workflow_directed", "abc123");
		expect(exp.map(e => e.key).sort()).toEqual(["lb", "pool", "waf"]);
		const wf = workflowNames("abc123");
		expect(exp.find(e => e.key === "pool")?.name).toBe(wf.pool);
		expect(exp.find(e => e.key === "lb")?.name).toBe(wf.lb);
	});
});

describe("resourcesCreated — GET status map → per-key booleans over the expected set", () => {
	it("200 → true, anything else → false", () => {
		const exp = expectedResources("free_plan", "abc123");
		const got = resourcesCreated({ hc: 200, pool: 200, lb: 404, waf: 0 }, exp);
		expect(got).toEqual({ hc: true, pool: true, lb: false, waf: false });
	});
	it("treats a missing key as not created", () => {
		const exp = expectedResources("workflow_directed", "abc123");
		expect(resourcesCreated({ pool: 200 }, exp)).toEqual({ pool: true, waf: false, lb: false });
	});
});

describe("workflowNames — deterministic {app_name}-scoped names", () => {
	it("is a pure function of the suffix", () => {
		expect(workflowNames("x")).toEqual(workflowNames("x"));
	});
	it("prefixes every resource with the app name", () => {
		const wf = workflowNames("x");
		expect(wf.pool.startsWith(wf.appName)).toBe(true);
		expect(wf.waf.startsWith(wf.appName)).toBe(true);
		expect(wf.lb.startsWith(wf.appName)).toBe(true);
	});
});

describe("reduceTimeline — DOM events + headline → RunMetrics", () => {
	const events: TimelineEvent[] = [
		{ t_ms: 100, className: "gutter g-user", body: "create stuff" },
		{ t_ms: 3200, className: "gutter g-tool-ok", body: "catalog_workflow_runner: ✓ ran waap-full-stack-demo" },
		{ t_ms: 12000, className: "gutter g-tool-ok", body: "navigate: ✓ opened form" },
		{ t_ms: 15000, className: "gutter g-tool-ok", body: "annotate: ✓ skipped: explain mode off" },
		{ t_ms: 16000, className: "gutter g-tool-err", body: "fill: ✗ transient" },
		{ t_ms: 20000, className: "gutter g-error", body: "xcsh is starting for this tab — one moment, then resend." },
		{ t_ms: 21000, className: "gutter g-error", body: "Turn aborted." },
		{ t_ms: 22000, className: "gutter g-assistant", body: "done" },
	];
	const m = reduceTimeline(events, {
		technique: "workflow_directed",
		run: 1,
		ttftMs: 3000,
		totalMs: 22500,
		statuses: { pool: 200, waf: 200, lb: 200 },
	});

	it("passes through headline metrics", () => {
		expect(m.technique).toBe("workflow_directed");
		expect(m.run).toBe(1);
		expect(m.ttft_ms).toBe(3000);
		expect(m.total_ms).toBe(22500);
	});
	it("counts only tool rows", () => {
		expect(m.tool_count).toBe(4); // 2 ok non-annotate + 1 annotate + 1 err
	});
	it("splits annotate into drawn vs skipped", () => {
		expect(m.annotate_skipped).toBe(1);
		expect(m.annotate_drawn).toBe(0);
	});
	it("collects real errors but drops the transient starting/resend flash", () => {
		expect(m.errors).toEqual(["Turn aborted."]);
	});
	it("builds a tool timeline with timestamps", () => {
		expect(m.timeline[0]).toEqual({ t_ms: 3200, toolName: "catalog_workflow_runner", ok: true });
		expect(m.timeline).toHaveLength(4);
	});
	it("maps resources_created over the technique's expected set", () => {
		expect(m.resources_created).toEqual({ pool: true, waf: true, lb: true });
	});
});

function mkRun(over: Partial<RunMetrics>): RunMetrics {
	return {
		technique: "free_plan",
		run: 1,
		ttft_ms: 100,
		total_ms: 1000,
		tool_count: 5,
		annotate_drawn: 0,
		annotate_skipped: 0,
		resources_created: { hc: true, pool: true, lb: true, waf: true },
		errors: [],
		timeline: [],
		...over,
	};
}

describe("aggregate — median per numeric metric + resource creation counts", () => {
	const runs = [
		mkRun({
			ttft_ms: 100,
			total_ms: 1000,
			tool_count: 4,
			resources_created: { hc: true, pool: true, lb: false, waf: true },
		}),
		mkRun({
			ttft_ms: 200,
			total_ms: 2000,
			tool_count: 6,
			resources_created: { hc: true, pool: true, lb: true, waf: true },
		}),
		mkRun({
			ttft_ms: 300,
			total_ms: 3000,
			tool_count: 8,
			resources_created: { hc: true, pool: false, lb: true, waf: true },
		}),
	];
	const agg = aggregate(runs);
	it("medians ttft/total/tool_count", () => {
		expect(agg.ttft_ms).toBe(200);
		expect(agg.total_ms).toBe(2000);
		expect(agg.tool_count).toBe(6);
	});
	it("counts, per resource, how many runs created it", () => {
		expect(agg.resources_created).toEqual({ hc: 3, pool: 2, lb: 2, waf: 3 });
	});
	it("records the median per-run resource count", () => {
		// per-run counts: 3, 4, 3 → median 3
		expect(agg.resource_count_median).toBe(3);
	});
	it("carries runs count and technique", () => {
		expect(agg.runs).toBe(3);
		expect(agg.technique).toBe("free_plan");
	});
});

describe("compareToBaseline — resource drops gate, timing only reports", () => {
	const base: MultiBenchResult = {
		workflow_directed: aggregate([
			mkRun({
				technique: "workflow_directed",
				ttft_ms: 3000,
				total_ms: 300000,
				resources_created: { pool: true, waf: true, lb: true },
			}),
		]),
	};
	it("flags a resource-count regression when a technique creates fewer than baseline", () => {
		const cur: MultiBenchResult = {
			workflow_directed: aggregate([
				mkRun({
					technique: "workflow_directed",
					ttft_ms: 3000,
					total_ms: 300000,
					resources_created: { pool: true, waf: false, lb: false },
				}),
			]),
		};
		const { resourceRegressions } = compareToBaseline(base, cur, { tolerancePct: 30, minAbsMs: 15 });
		expect(resourceRegressions.length).toBe(1);
		expect(resourceRegressions[0]).toContain("workflow_directed");
	});
	it("does NOT flag a resource regression when the count holds", () => {
		const cur: MultiBenchResult = {
			workflow_directed: aggregate([
				mkRun({
					technique: "workflow_directed",
					ttft_ms: 3000,
					total_ms: 300000,
					resources_created: { pool: true, waf: true, lb: true },
				}),
			]),
		};
		expect(compareToBaseline(base, cur, { tolerancePct: 30, minAbsMs: 15 }).resourceRegressions).toEqual([]);
	});
	it("never puts timing in the gating list — even a huge slowdown only appears as a reported delta", () => {
		const cur: MultiBenchResult = {
			workflow_directed: aggregate([
				mkRun({
					technique: "workflow_directed",
					ttft_ms: 90000,
					total_ms: 900000,
					resources_created: { pool: true, waf: true, lb: true },
				}),
			]),
		};
		const res = compareToBaseline(base, cur, { tolerancePct: 30, minAbsMs: 15 });
		expect(res.resourceRegressions).toEqual([]);
		expect(res.timingDeltas.some(d => d.metric === "ttft_ms" && d.deltaPct > 100)).toBe(true);
	});
});

describe("formatTable — human-readable comparison", () => {
	const cur: MultiBenchResult = {
		workflow_directed: aggregate([mkRun({ technique: "workflow_directed" })]),
		free_plan: aggregate([mkRun({ technique: "free_plan" })]),
	};
	it("returns a string naming the techniques and key columns", () => {
		const table = formatTable(cur);
		expect(table).toContain("workflow_directed");
		expect(table).toContain("free_plan");
		expect(table.toLowerCase()).toContain("ttft");
	});
});
