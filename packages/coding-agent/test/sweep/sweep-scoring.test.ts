import { describe, expect, it } from "bun:test";
import { apiItemPath, apiKindFor, scoreOperation } from "../../src/sweep/sweep-scoring";

describe("apiItemPath — per-resource API group/path", () => {
	it("uses the standard config path by default", () => {
		expect(apiItemPath("http-load-balancer", "demo", "x")).toBe("/api/config/namespaces/demo/http_loadbalancers/x");
	});
	it("routes DNS-group resources under /api/config/dns", () => {
		expect(apiItemPath("dns-zone", "demo", "x")).toBe("/api/config/dns/namespaces/demo/dns_zones/x");
		expect(apiItemPath("geo-location-set", "demo", "x")).toBe("/api/config/dns/namespaces/demo/geo_location_sets/x");
	});
	it("routes secret-policy under /api/secret_management", () => {
		expect(apiItemPath("secret-policy", "demo", "p")).toBe("/api/secret_management/namespaces/demo/secret_policys/p");
	});
	it("routes credentials under /api/web and role under /api/web/custom", () => {
		expect(apiItemPath("api-credential", "demo", "c")).toBe("/api/web/namespaces/demo/api_credentials/c");
		expect(apiItemPath("role", "system", "r")).toBe("/api/web/custom/namespaces/system/roles/r");
	});
	it("routes synthetic monitors under /api/observability/synthetic_monitor", () => {
		expect(apiItemPath("v1-dns-monitor", "demo", "m")).toBe(
			"/api/observability/synthetic_monitor/namespaces/demo/v1_dns_monitors/m",
		);
	});
});

describe("apiKindFor", () => {
	it("applies known API-kind overrides", () => {
		expect(apiKindFor("health-check")).toBe("healthchecks");
		expect(apiKindFor("http-load-balancer")).toBe("http_loadbalancers");
		expect(apiKindFor("tcp-load-balancer")).toBe("tcp_loadbalancers");
		expect(apiKindFor("route-object")).toBe("routes");
	});

	it("falls back to underscored pluralization", () => {
		expect(apiKindFor("bgp-asn-set")).toBe("bgp_asn_sets");
		expect(apiKindFor("api-credential")).toBe("api_credentials");
		expect(apiKindFor("origin-pool")).toBe("origin_pools");
	});
});

describe("scoreOperation — strict cross-check", () => {
	it("create: runner pass + API exists + no banner = pass", () => {
		const v = scoreOperation({
			operation: "create",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: true,
			errorBanner: false,
		});
		expect(v.verdict).toBe("pass");
	});

	it("create: runner SKIPPED (already exists) = indeterminate, NEVER pass", () => {
		const v = scoreOperation({
			operation: "create",
			runnerStatus: "pass",
			runnerSkipped: true,
			apiExists: true,
			errorBanner: false,
		});
		expect(v.verdict).toBe("indeterminate");
		expect(v.reason).toMatch(/skip/i);
	});

	it("create: runner claims pass but API says not-exists = fail (catches false positive)", () => {
		const v = scoreOperation({
			operation: "create",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: false,
			errorBanner: false,
		});
		expect(v.verdict).toBe("fail");
		expect(v.reason).toMatch(/api/i);
	});

	it("create: runner pass + API exists but error banner present = fail", () => {
		const v = scoreOperation({
			operation: "create",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: true,
			errorBanner: true,
		});
		expect(v.verdict).toBe("fail");
		expect(v.reason).toMatch(/banner|error/i);
	});

	it("create: runner fail = fail", () => {
		const v = scoreOperation({
			operation: "create",
			runnerStatus: "fail",
			runnerSkipped: false,
			apiExists: false,
			errorBanner: false,
		});
		expect(v.verdict).toBe("fail");
	});

	it("delete: runner pass + API gone = pass", () => {
		const v = scoreOperation({
			operation: "delete",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: false,
			errorBanner: false,
		});
		expect(v.verdict).toBe("pass");
	});

	it("delete: runner pass but resource still exists = fail", () => {
		const v = scoreOperation({
			operation: "delete",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: true,
			errorBanner: false,
		});
		expect(v.verdict).toBe("fail");
	});

	it("read: runner pass + API exists = pass", () => {
		const v = scoreOperation({
			operation: "read",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: true,
			errorBanner: false,
		});
		expect(v.verdict).toBe("pass");
	});

	it("update: runner pass + API exists = pass", () => {
		const v = scoreOperation({
			operation: "update",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: true,
			errorBanner: false,
		});
		expect(v.verdict).toBe("pass");
	});

	it("treats a null API check as indeterminate, not a pass", () => {
		const v = scoreOperation({
			operation: "create",
			runnerStatus: "pass",
			runnerSkipped: false,
			apiExists: null,
			errorBanner: false,
		});
		expect(v.verdict).toBe("indeterminate");
	});
});
