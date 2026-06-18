import { describe, expect, it } from "bun:test";
import { createConsoleResolver } from "../../src/internal-urls/console-resolve";
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
