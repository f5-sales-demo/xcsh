import { describe, expect, it } from "bun:test";
import { CONSOLE_CATALOG_DATA } from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog.generated";
import { canonicalizeResource, createConsoleResolver } from "../../src/internal-urls/console-resolve";
import { parseInternalUrl } from "../../src/internal-urls/parse";

const catalog = {
	version: "test",
	workflows: {
		"http-load-balancer/create":
			"id: http-load-balancer-create\nlabel: Create HTTP Load Balancer\nsteps:\n  - id: navigate-to-list\n    action: navigate\n    url: /web/.../http_loadbalancers\n  - id: save\n    action: click\n    selector: \"button:text('Add HTTP Load Balancer')\"\n",
	},
	resources: {
		"http-load-balancer":
			"id: http-load-balancer\nlabel: HTTP Load Balancers\nconsole:\n  route_pattern: /namespaces/{namespace}/manage/load_balancers/http_loadbalancers\n  menu_path: [Web App & API Protection, Manage, Load Balancers, HTTP Load Balancers]\n",
	},
	routes: {},
	navigation: null,
};

describe("createConsoleResolver", () => {
	it("lists resources at the root", async () => {
		const r = createConsoleResolver(catalog);
		const res = await r.resolve(parseInternalUrl("xcsh://console/") as never);
		expect(res.contentType).toBe("text/markdown");
		expect(res.content).toContain("http-load-balancer");
	});

	it("renders a resource's route and operations", async () => {
		const r = createConsoleResolver(catalog);
		const res = await r.resolve(parseInternalUrl("xcsh://console/http-load-balancer") as never);
		expect(res.content).toContain("/manage/load_balancers/http_loadbalancers");
		expect(res.content).toContain("create");
	});

	it("renders ordered workflow steps for a resource/operation", async () => {
		const r = createConsoleResolver(catalog);
		const res = await r.resolve(parseInternalUrl("xcsh://console/http-load-balancer/create") as never);
		expect(res.content).toContain("navigate-to-list");
		expect(res.content).toContain("Add HTTP Load Balancer");
	});
});

const has = !!CONSOLE_CATALOG_DATA.resources["health-check"];

describe.skipIf(!has)("console resource canonicalization", () => {
	it("maps near-miss names to the canonical key", () => {
		for (const n of ["healthcheck", "health_check", "healthchecks", "Health-Check"]) {
			expect(canonicalizeResource(n, CONSOLE_CATALOG_DATA)).toBe("health-check");
		}
	});
	it("returns null for a genuinely unknown resource", () => {
		expect(canonicalizeResource("nonexistent-thing", CONSOLE_CATALOG_DATA)).toBeNull();
	});
	it("a near-miss resource URL renders the canonical resource, not 'Unknown'", async () => {
		const r = createConsoleResolver(CONSOLE_CATALOG_DATA);
		const res = await r.resolve({
			rawPathname: "/healthcheck",
			pathname: "/healthcheck",
			rawHost: "console",
			href: "xcsh://console/healthcheck",
		} as never);
		expect(res.content).not.toMatch(/Unknown console resource/);
		expect(res.content).toMatch(/health-check\/create/);
	});
	it("a truly unknown resource lists available resources", async () => {
		const r = createConsoleResolver(CONSOLE_CATALOG_DATA);
		const res = await r.resolve({
			rawPathname: "/nope",
			pathname: "/nope",
			rawHost: "console",
			href: "xcsh://console/nope",
		} as never);
		expect(res.content).toMatch(/Available resources/);
		expect(res.content).toMatch(/health-check/);
	});
});
