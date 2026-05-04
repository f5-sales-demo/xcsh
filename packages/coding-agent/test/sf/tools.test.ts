import { describe, expect, it } from "bun:test";
import { normalizeOrg, SfOrgDisplayTool, SfQueryTool, SfSetupTool } from "../../src/tools/sf";

describe("SfSetupTool", () => {
	it("has correct name and label", () => {
		const tool = new SfSetupTool({ cwd: "/tmp" } as any);
		expect(tool.name).toBe("sf_setup");
		expect(tool.label).toBe("Salesforce Setup");
	});

	it("has a non-empty description", () => {
		const tool = new SfSetupTool({ cwd: "/tmp" } as any);
		expect(tool.description.length).toBeGreaterThan(0);
	});

	it("has a parameters schema with action field", () => {
		const tool = new SfSetupTool({ cwd: "/tmp" } as any);
		expect(tool.parameters).toBeDefined();
		expect(tool.parameters.properties.action).toBeDefined();
	});
});

describe("SfQueryTool", () => {
	it("has correct name and label", () => {
		const tool = new SfQueryTool({ cwd: "/tmp" } as any);
		expect(tool.name).toBe("sf_query");
		expect(tool.label).toBe("Salesforce Query");
	});

	it("has a non-empty description", () => {
		const tool = new SfQueryTool({ cwd: "/tmp" } as any);
		expect(tool.description.length).toBeGreaterThan(0);
	});

	it("has a parameters schema with query field", () => {
		const tool = new SfQueryTool({ cwd: "/tmp" } as any);
		expect(tool.parameters).toBeDefined();
		expect(tool.parameters.properties.query).toBeDefined();
	});
});

describe("SfOrgDisplayTool", () => {
	it("has correct name and label", () => {
		const tool = new SfOrgDisplayTool({ cwd: "/tmp" } as any);
		expect(tool.name).toBe("sf_org_display");
		expect(tool.label).toBe("Salesforce Org Display");
	});

	it("has a non-empty description", () => {
		const tool = new SfOrgDisplayTool({ cwd: "/tmp" } as any);
		expect(tool.description.length).toBeGreaterThan(0);
	});

	it("has a parameters schema with optional target_org field", () => {
		const tool = new SfOrgDisplayTool({ cwd: "/tmp" } as any);
		expect(tool.parameters).toBeDefined();
		expect(tool.parameters.properties.target_org).toBeDefined();
	});
});

describe("normalizeOrg", () => {
	it("maps defaultMarker '(U)' to isDefault true", () => {
		const org = normalizeOrg({
			alias: "myorg",
			username: "user@test.com",
			orgId: "00D123",
			instanceUrl: "https://test.salesforce.com",
			connectedStatus: "Connected",
			defaultMarker: "(U)",
			isSandbox: false,
		});
		expect(org.isDefault).toBe(true);
		expect(org.username).toBe("user@test.com");
		expect(org.connectedStatus).toBe("Connected");
	});

	it("maps isDefaultUsername true to isDefault true", () => {
		const org = normalizeOrg({
			alias: "myorg",
			username: "user@test.com",
			orgId: "00D123",
			instanceUrl: "https://test.salesforce.com",
			connectedStatus: "Connected",
			isDefaultUsername: true,
			isSandbox: false,
		});
		expect(org.isDefault).toBe(true);
	});

	it("maps non-default org to isDefault false", () => {
		const org = normalizeOrg({
			username: "user@test.com",
			orgId: "00D123",
			instanceUrl: "https://test.salesforce.com",
			connectedStatus: "Connected",
			isSandbox: false,
		});
		expect(org.isDefault).toBe(false);
	});

	it("falls back to 'Unknown' when connectedStatus is missing", () => {
		const org = normalizeOrg({
			username: "user@test.com",
			orgId: "00D123",
			instanceUrl: "https://test.salesforce.com",
		});
		expect(org.connectedStatus).toBe("Unknown");
	});

	it("handles orgid (lowercase) from raw CLI output", () => {
		const org = normalizeOrg({
			username: "user@test.com",
			orgid: "00D456",
			instanceUrl: "https://test.salesforce.com",
		});
		expect(org.orgId).toBe("00D456");
	});

	it("maps isSandbox correctly", () => {
		const org = normalizeOrg({
			username: "user@test.com",
			orgId: "00D123",
			instanceUrl: "https://test.salesforce.com",
			isSandbox: true,
		});
		expect(org.isSandbox).toBe(true);
	});
});
