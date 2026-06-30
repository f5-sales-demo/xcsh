import { describe, expect, it } from "bun:test";
import { buildDepGraph } from "../../src/sweep/dependency-graph";

const RESOURCES = ["http-load-balancer", "origin-pool", "app-firewall", "health-check", "ip-prefix-set", "cluster"];

const SCHEMAS: Record<string, Record<string, unknown>> = {
	viewshttp_loadbalancerCreateSpecType: {
		properties: {
			"app-firewall": { allOf: [{ $ref: "#/components/schemas/schemaviewsObjectRefType" }] },
			"origin-pool": { allOf: [{ $ref: "#/components/schemas/schemaviewsObjectRefType" }] },
		},
	},
	viewsorigin_poolCreateSpecType: {
		properties: {
			"health-check": { allOf: [{ $ref: "#/components/schemas/schemaviewsObjectRefType" }] },
		},
	},
	app_firewallCreateSpecType: { properties: {} },
	healthcheckCreateSpecType: { properties: {} },
	ip_prefix_setCreateSpecType: { properties: {} },
	clusterCreateSpecType: { properties: {} },
};

describe("buildDepGraph", () => {
	const g = buildDepGraph(SCHEMAS, RESOURCES);

	it("identifies dependency edges from ObjectRefType", () => {
		expect(g.edges["http-load-balancer"]).toContain("app-firewall");
		expect(g.edges["http-load-balancer"]).toContain("origin-pool");
		expect(g.edges["origin-pool"]).toContain("health-check");
	});

	it("identifies leaves (no dependencies)", () => {
		expect(g.leaves).toContain("app-firewall");
		expect(g.leaves).toContain("health-check");
		expect(g.leaves).toContain("ip-prefix-set");
		expect(g.leaves).toContain("cluster");
		expect(g.leaves).not.toContain("http-load-balancer");
	});

	it("identifies prerequisites (depended on by others)", () => {
		expect(g.prerequisites).toContain("app-firewall");
		expect(g.prerequisites).toContain("origin-pool");
		expect(g.prerequisites).toContain("health-check");
	});

	it("topologically sorts dependencies before dependents", () => {
		const idx = (r: string) => g.sorted.indexOf(r);
		// health-check before origin-pool (origin-pool depends on health-check)
		expect(idx("health-check")).toBeLessThan(idx("origin-pool"));
		// origin-pool + app-firewall before http-load-balancer
		expect(idx("origin-pool")).toBeLessThan(idx("http-load-balancer"));
		expect(idx("app-firewall")).toBeLessThan(idx("http-load-balancer"));
	});
});
