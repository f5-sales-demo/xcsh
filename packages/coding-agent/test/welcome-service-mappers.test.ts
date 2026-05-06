import { describe, expect, it } from "bun:test";
import {
	mapAzureStatus,
	mapContextStatus,
	mapGitHubStatus,
	mapGitLabStatus,
	mapSalesforceStatus,
} from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";

describe("mapContextStatus", () => {
	it("no_context → unauthenticated with /context create hint", () => {
		const r = mapContextStatus({ state: "no_context" });
		expect(r.name).toBe("F5 XC Context");
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context create");
	});
	it("connected → connected", () => {
		const r = mapContextStatus({ state: "connected", name: "prod", latencyMs: 10 });
		expect(r.state).toBe("connected");
		expect(r.name).toBe("F5 XC Context");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with /context hint", () => {
		const r = mapContextStatus({ state: "auth_error", name: "prod" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context");
	});
	it("offline → unauthenticated with /context hint", () => {
		const r = mapContextStatus({ state: "offline", name: "prod" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context");
	});
});

describe("mapGitLabStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapGitLabStatus(undefined);
		expect(r.name).toBe("GitLab");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapGitLabStatus({ state: "connected", project: "group/repo" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with glab hint", () => {
		const r = mapGitLabStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("glab auth login");
	});
	it("not_configured → unauthenticated with glab hint", () => {
		const r = mapGitLabStatus({ state: "not_configured" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("glab auth login");
	});
	it("project_inaccessible → unauthenticated with glab hint", () => {
		const r = mapGitLabStatus({ state: "project_inaccessible", project: "g/r" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("glab auth login");
	});
});

describe("mapSalesforceStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapSalesforceStatus(undefined);
		expect(r.name).toBe("Salesforce");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapSalesforceStatus({ state: "connected", orgAlias: "SFDC" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with sf hint", () => {
		const r = mapSalesforceStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("sf org login web");
	});
	it("session_expired → unauthenticated with sf hint", () => {
		const r = mapSalesforceStatus({ state: "session_expired", orgAlias: "SFDC" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("sf org login web");
	});
	it("not_configured → unauthenticated with sf hint", () => {
		const r = mapSalesforceStatus({ state: "not_configured" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("sf org login web");
	});
});

describe("mapGitHubStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapGitHubStatus(undefined);
		expect(r.name).toBe("GitHub");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapGitHubStatus({ state: "connected" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with gh auth login hint", () => {
		const r = mapGitHubStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("gh auth login");
	});
});

describe("mapAzureStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapAzureStatus(undefined);
		expect(r.name).toBe("Azure");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapAzureStatus({ state: "connected" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with az login hint", () => {
		const r = mapAzureStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("az login --use-device-code");
	});
});
