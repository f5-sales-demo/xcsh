/**
 * Unit tests for the pure helpers in the panel-driven E2E harness.
 *
 * The browser-driving parts of `panel-harness.ts` are gated E2E (real Chrome +
 * staging creds) and never run in CI. But the harness also carries pure logic —
 * the turn-done DOM predicate, deterministic resource naming, the dependency-safe
 * cleanup order, config API path building, and the live-run gate. Those are the
 * pieces most likely to rot silently, so they get real coverage here and run in
 * CI (no Chrome, no network).
 *
 * Run: bun test test/e2e/panel-harness.test.ts
 */
import { describe, expect, it } from "bun:test";
import { canRunLive, cleanupOrder, isTurnDoneDom, resourceNames, resourcePath } from "./harness/panel-harness";

/** Minimal fake Document: querySelector returns truthy iff the selector is in `present`. */
function fakeDoc(present: string[]) {
	return {
		querySelector(sel: string): unknown {
			return present.includes(sel) ? { sel } : null;
		},
	};
}

describe("isTurnDoneDom — the #send/#stop swap that marks a turn terminal", () => {
	it("true when #send is present and #stop is absent (idle → turn finished)", () => {
		expect(isTurnDoneDom(fakeDoc(["#send"]))).toBe(true);
	});
	it("false while streaming (#stop present, #send swapped out)", () => {
		expect(isTurnDoneDom(fakeDoc(["#stop"]))).toBe(false);
	});
	it("false before the panel is ready (neither button present yet)", () => {
		expect(isTurnDoneDom(fakeDoc([]))).toBe(false);
	});
	it("false if both are somehow present (mid-swap) — require send-only to be safe", () => {
		expect(isTurnDoneDom(fakeDoc(["#send", "#stop"]))).toBe(false);
	});
});

describe("resourceNames — deterministic, suffix-scoped names for a run", () => {
	it("bakes the run suffix into every name so reruns never collide", () => {
		const n = resourceNames("abc123");
		for (const v of Object.values(n)) expect(v).toContain("abc123");
	});
	it("is a pure function of the suffix (same suffix → identical names)", () => {
		expect(resourceNames("x")).toEqual(resourceNames("x"));
	});
	it("gives distinct names to distinct resources", () => {
		const n = resourceNames("x");
		const values = Object.values(n);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("cleanupOrder — delete respects the F5 XC reference chain", () => {
	it("deletes the load balancer before the origin pool before the health check", () => {
		const order = cleanupOrder(resourceNames("x")).map(e => e.resource);
		const idx = (r: string) => order.indexOf(r);
		expect(idx("http_loadbalancers")).toBeGreaterThanOrEqual(0);
		expect(idx("http_loadbalancers")).toBeLessThan(idx("origin_pools"));
		expect(idx("origin_pools")).toBeLessThan(idx("healthchecks"));
	});
	it("deletes the app firewall after the load balancer that references it", () => {
		const order = cleanupOrder(resourceNames("x")).map(e => e.resource);
		expect(order.indexOf("http_loadbalancers")).toBeLessThan(order.indexOf("app_firewalls"));
	});
	it("covers every named resource exactly once", () => {
		const names = resourceNames("x");
		const cleaned = cleanupOrder(names)
			.map(e => e.name)
			.sort();
		expect(cleaned).toEqual(Object.values(names).sort());
	});
});

describe("resourcePath — config API path builder (mirrors staging-crud)", () => {
	it("builds a collection path without a name", () => {
		expect(resourcePath("r-mordasiewicz", "healthchecks")).toBe("/api/config/namespaces/r-mordasiewicz/healthchecks");
	});
	it("appends the item name for a per-resource path", () => {
		expect(resourcePath("ns1", "http_loadbalancers", "lb-1")).toBe(
			"/api/config/namespaces/ns1/http_loadbalancers/lb-1",
		);
	});
});

describe("canRunLive — the live-run gate", () => {
	const full = {
		XCSH_STAGING_API_URL: "https://x",
		XCSH_STAGING_API_TOKEN: "t",
		XCSH_STAGING_USERNAME: "u",
		XCSH_STAGING_PASSWORD: "p",
	};
	it("runs only when all four staging vars are set and not in CI", () => {
		expect(canRunLive({ ...full })).toBe(true);
	});
	it("skips in CI even with full creds", () => {
		expect(canRunLive({ ...full, CI: "true" })).toBe(false);
		expect(canRunLive({ ...full, GITHUB_ACTIONS: "true" })).toBe(false);
	});
	it("skips when any credential is missing", () => {
		for (const k of Object.keys(full)) {
			const partial = { ...full } as Record<string, string | undefined>;
			delete partial[k];
			expect(canRunLive(partial)).toBe(false);
		}
	});
});
