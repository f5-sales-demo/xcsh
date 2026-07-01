import { describe, expect, it } from "bun:test";
import { interpretPageState, type PageState, type RouteEntry } from "../../src/browser/page-state-interpreter";

const ROUTES: RouteEntry[] = [
	{
		resourceId: "origin-pool",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/origin_pools",
	},
	{
		resourceId: "http-load-balancer",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/http_loadbalancers",
	},
	{
		resourceId: "health-check",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/health_checks",
	},
	{
		resourceId: "fleet",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/fleets",
	},
];

describe("interpretPageState", () => {
	it("detects LIST view (URL matches collection route)", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools",
			null,
			ROUTES,
		);
		expect(state.workspace).toBe("web-app-and-api-protection");
		expect(state.resource).toBe("origin-pool");
		expect(state.operation).toBe("list");
		expect(state.namespace).toBe("demo");
	});

	it("detects CREATE view (form visible with New badge)", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools",
			{ formVisible: true, newBadge: true },
			ROUTES,
		);
		expect(state.operation).toBe("create");
	});

	it("detects VIEW (URL has resource name, no edits active)", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools/my-pool",
			null,
			ROUTES,
		);
		expect(state.operation).toBe("view");
		expect(state.resourceName).toBe("my-pool");
		expect(state.resource).toBe("origin-pool");
	});

	it("detects EDIT (URL has resource name + Enable Edits active)", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools/my-pool",
			{ enableEditsActive: true },
			ROUTES,
		);
		expect(state.operation).toBe("edit");
		expect(state.resourceName).toBe("my-pool");
	});

	it("extracts namespace from URL", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/production/manage/load_balancers/health_checks",
			null,
			ROUTES,
		);
		expect(state.namespace).toBe("production");
		expect(state.resource).toBe("health-check");
	});

	it("returns unknown for unrecognized URLs", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/some-unknown-page",
			null,
			ROUTES,
		);
		expect(state.resource).toBeNull();
		expect(state.operation).toBe("unknown");
	});

	it("detects STAGING LOGIN (Keycloak OIDC — verified from live OIDC discovery)", () => {
		const state = interpretPageState(
			"https://login-staging.volterra.us/auth/realms/example-tenant-abc123/protocol/openid-connect/auth?state=550ce00d&nonce=7d5e52d",
			null,
			ROUTES,
		);
		expect(state.operation).toBe("login");
		expect(state.resource).toBeNull();
		expect(state.workspace).toBeNull();
		expect(state.environment).toBe("staging");
		expect(state.tenant).toBe("example-tenant");
		expect(state.resourceName).toBe("auth"); // OIDC action
	});

	it("detects PRODUCTION LOGIN (login.ves.volterra.io)", () => {
		const state = interpretPageState(
			"https://login.ves.volterra.io/auth/realms/acme-corp-xyz789/protocol/openid-connect/auth",
			null,
			ROUTES,
		);
		expect(state.operation).toBe("login");
		expect(state.environment).toBe("production");
		expect(state.tenant).toBe("acme-corp");
	});

	it("detects tenant + environment on CONSOLE pages (staging)", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools",
			null,
			ROUTES,
		);
		expect(state.tenant).toBe("example-tenant");
		expect(state.environment).toBe("staging");
	});

	it("detects tenant + environment on CONSOLE pages (production)", () => {
		const state = interpretPageState(
			"https://acme-corp.console.ves.volterra.io/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools",
			null,
			ROUTES,
		);
		expect(state.tenant).toBe("acme-corp");
		expect(state.environment).toBe("production");
	});

	it("rejects spoofed login domain (security)", () => {
		const state = interpretPageState(
			"https://login.evil.com/auth/realms/t/protocol/openid-connect/auth",
			null,
			ROUTES,
		);
		expect(state.operation).not.toBe("login");
	});

	it("handles non-namespaced routes (fleet)", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/multi-cloud-network-connect/manage/site_management/legacy_configs/fleets",
			null,
			ROUTES,
		);
		expect(state.resource).toBe("fleet");
		expect(state.workspace).toBe("multi-cloud-network-connect");
		expect(state.operation).toBe("list");
	});

	it("includes modal blocking info when provided", () => {
		const state = interpretPageState(
			"https://example-tenant.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/origin_pools",
			{ modalBlocking: true, modalText: "How easy was it..." },
			ROUTES,
		);
		expect(state.modalBlocking).toBe(true);
		expect(state.modalText).toBe("How easy was it...");
	});
});
