import { describe, expect, it } from "bun:test";
import { collectAllOrgs, normalizeOrg, SfOrgDisplayTool, SfQueryTool, SfSetupTool } from "../../src/tools/sf";
import type { SfExecApi } from "../../src/tools/sf/exec";
import type { SfRawResult } from "../../src/tools/sf/types";

const SESSION = { cwd: "/tmp" } as any;

function mockApi(responses: Array<{ stdout: string; stderr?: string; exitCode?: number }>): SfExecApi {
	let callIndex = 0;
	return {
		async exec(): Promise<SfRawResult> {
			const r = responses[callIndex++] ?? { stdout: "", stderr: "no mock", exitCode: 1 };
			return { stdout: r.stdout, stderr: r.stderr ?? "", exitCode: r.exitCode ?? 0 };
		},
	};
}

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

describe("collectAllOrgs", () => {
	it("deduplicates orgs that appear in multiple arrays", () => {
		const rawOrgList = {
			nonScratchOrgs: [
				{
					alias: "f5",
					username: "user@f5.com",
					orgId: "00D000000000001",
					instanceUrl: "https://f5.my.salesforce.com",
					connectedStatus: "Connected",
					isDefaultUsername: true,
					isSandbox: false,
				},
			],
			scratchOrgs: [],
			sandboxes: [],
			devHubs: [],
			other: [
				{
					alias: "f5",
					username: "user@f5.com",
					orgId: "00D000000000001",
					instanceUrl: "https://f5.my.salesforce.com",
					connectedStatus: "Connected",
					defaultMarker: "(U)",
					isSandbox: false,
				},
			],
		};
		const orgs = collectAllOrgs(rawOrgList as Record<string, unknown[]>);
		expect(orgs).toHaveLength(1);
		expect(orgs[0].orgId).toBe("00D000000000001");
		expect(orgs[0].isDefault).toBe(true);
	});

	it("preserves distinct orgs from different arrays", () => {
		const rawOrgList = {
			nonScratchOrgs: [
				{
					username: "user@prod.com",
					orgId: "00D000000000001",
					instanceUrl: "https://prod.salesforce.com",
					connectedStatus: "Connected",
				},
			],
			scratchOrgs: [
				{
					username: "user@scratch.com",
					orgId: "00D000000000002",
					instanceUrl: "https://scratch.salesforce.com",
					connectedStatus: "Connected",
				},
			],
		};
		const orgs = collectAllOrgs(rawOrgList as Record<string, unknown[]>);
		expect(orgs).toHaveLength(2);
	});

	it("handles empty and missing arrays gracefully", () => {
		const orgs = collectAllOrgs({} as Record<string, unknown[]>);
		expect(orgs).toHaveLength(0);
	});
});

// ─── SfSetupTool.execute() ───────────────────────────────────────────────

describe("SfSetupTool.execute()", () => {
	it("check action returns sf version", async () => {
		const api = mockApi([{ stdout: "@salesforce/cli/2.132.14 darwin-arm64 node-v25.9.0" }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "check" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("2.132.14");
	});

	it("status action returns deduped org table", async () => {
		const orgList = JSON.stringify({
			status: 0,
			result: {
				nonScratchOrgs: [
					{
						alias: "f5",
						username: "u@f5.com",
						orgId: "00D001",
						instanceUrl: "https://f5.my.salesforce.com",
						connectedStatus: "Connected",
						isDefaultUsername: true,
					},
				],
				scratchOrgs: [],
				sandboxes: [],
				devHubs: [],
				other: [
					{
						alias: "f5",
						username: "u@f5.com",
						orgId: "00D001",
						instanceUrl: "https://f5.my.salesforce.com",
						connectedStatus: "Connected",
						defaultMarker: "(U)",
					},
				],
			},
		});
		const api = mockApi([{ stdout: orgList }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "status" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		// Only one row in the table (deduped)
		const dataRows = text.split("\n").filter(l => l.startsWith("|") && !l.includes("---") && !l.includes("Alias"));
		expect(dataRows).toHaveLength(1);
		expect(result.details?.orgs).toHaveLength(1);
	});

	it("login action returns already-authenticated when orgs exist", async () => {
		const orgList = JSON.stringify({
			status: 0,
			result: {
				nonScratchOrgs: [
					{ username: "u@f5.com", orgId: "00D001", instanceUrl: "https://x", connectedStatus: "Connected" },
				],
				scratchOrgs: [],
			},
		});
		const api = mockApi([{ stdout: orgList }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "login" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("Already authenticated");
	});

	it("login action shows instructions when no orgs", async () => {
		const orgList = JSON.stringify({
			status: 0,
			result: { nonScratchOrgs: [], scratchOrgs: [] },
		});
		const api = mockApi([{ stdout: orgList }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "login" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("sf org login web");
		expect(text).toContain("sfdx-url");
	});

	it("set_default rejects shell metacharacters", async () => {
		const api = mockApi([]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "set_default", org: "org;rm -rf /" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("invalid org alias");
	});

	it("set_default requires org parameter", async () => {
		const api = mockApi([]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "set_default" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("org parameter is required");
	});

	it("unknown action returns error", async () => {
		const api = mockApi([]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "bogus" as any });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("Unknown action");
	});
});

// ─── SfQueryTool.execute() ───────────────────────────────────────────────

describe("SfQueryTool.execute()", () => {
	it("returns formatted markdown table for normal query", async () => {
		const queryResult = JSON.stringify({
			status: 0,
			result: {
				totalSize: 1,
				done: true,
				records: [{ attributes: { type: "Account" }, Name: "Acme", Industry: "Tech" }],
			},
		});
		const api = mockApi([{ stdout: queryResult }]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT Name, Industry FROM Account" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("1 records");
		expect(text).toContain("Acme");
		expect(text).not.toContain("attributes");
	});

	it("flattens relationship fields in results", async () => {
		const queryResult = JSON.stringify({
			status: 0,
			result: {
				totalSize: 1,
				done: true,
				records: [
					{
						attributes: { type: "Opportunity" },
						Name: "Deal",
						Account: { attributes: { type: "Account" }, Name: "Acme" },
					},
				],
			},
		});
		const api = mockApi([{ stdout: queryResult }]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT Name, Account.Name FROM Opportunity" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("Account.Name");
		expect(text).toContain("Acme");
	});

	it("rejects invalid target_org before calling CLI", async () => {
		const api = mockApi([]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT Id FROM Account", target_org: "bad;shell" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("invalid org alias");
	});

	it("returns isError result for MALFORMED_QUERY instead of throwing", async () => {
		const errorPayload = JSON.stringify({
			status: 1,
			result: null,
			message: "MALFORMED_QUERY: unexpected token",
		});
		const api = mockApi([{ stdout: errorPayload }]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT * FROM" });
		expect(result.isError).toBe(true);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("MALFORMED_QUERY");
	});

	it("sets errorType to invalid_query for MALFORMED_QUERY", async () => {
		const errorPayload = JSON.stringify({
			status: 1,
			result: null,
			message: "MALFORMED_QUERY: unexpected token",
		});
		const api = mockApi([{ stdout: errorPayload }]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT * FROM" });
		expect(result.details?.errorType).toBe("invalid_query");
	});
});

// ─── SfOrgDisplayTool.execute() ──────────────────────────────────────────

describe("SfOrgDisplayTool.execute()", () => {
	it("returns safe fields and strips tokens", async () => {
		const displayResult = JSON.stringify({
			status: 0,
			result: {
				id: "00D123",
				username: "admin@example.com",
				instanceUrl: "https://example.salesforce.com",
				connectedStatus: "Connected",
				alias: "prod",
				accessToken: "SENSITIVE_TOKEN_DO_NOT_EXPOSE",
				clientId: "SECRET_CLIENT_ID",
				refreshToken: "SECRET_REFRESH",
			},
		});
		const api = mockApi([{ stdout: displayResult }]);
		const tool = new SfOrgDisplayTool(SESSION, api);
		const result = await tool.execute("c1", {});
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("admin@example.com");
		expect(text).toContain("00D123");
		expect(text).not.toContain("SENSITIVE_TOKEN");
		expect(text).not.toContain("SECRET_CLIENT");
		expect(text).not.toContain("SECRET_REFRESH");
	});

	it("maps id field to orgId", async () => {
		const displayResult = JSON.stringify({
			status: 0,
			result: { id: "00DABC", username: "u@test.com", instanceUrl: "https://x", connectedStatus: "Connected" },
		});
		const api = mockApi([{ stdout: displayResult }]);
		const tool = new SfOrgDisplayTool(SESSION, api);
		const result = await tool.execute("c1", {});
		expect(result.details?.orgs?.[0].orgId).toBe("00DABC");
	});

	it("rejects invalid target_org", async () => {
		const api = mockApi([]);
		const tool = new SfOrgDisplayTool(SESSION, api);
		const result = await tool.execute("c1", { target_org: "$(whoami)" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("invalid org alias");
	});
});

// --- SfQueryTool new parameters and incomplete results ---

describe("SfQueryTool.execute() extended", () => {
	it("passes --use-tooling-api flag when requested", async () => {
		let capturedArgs: string[] = [];
		const api: SfExecApi = {
			async exec(_cmd: string, args: string[]): Promise<SfRawResult> {
				capturedArgs = args;
				return {
					stdout: JSON.stringify({ status: 0, result: { totalSize: 0, done: true, records: [] } }),
					stderr: "",
					exitCode: 0,
				};
			},
		};
		const tool = new SfQueryTool(SESSION, api);
		await tool.execute("c1", { query: "SELECT Name FROM ApexTrigger", use_tooling_api: true });
		expect(capturedArgs).toContain("--use-tooling-api");
	});

	it("passes --all-rows flag when requested", async () => {
		let capturedArgs: string[] = [];
		const api: SfExecApi = {
			async exec(_cmd: string, args: string[]): Promise<SfRawResult> {
				capturedArgs = args;
				return {
					stdout: JSON.stringify({ status: 0, result: { totalSize: 0, done: true, records: [] } }),
					stderr: "",
					exitCode: 0,
				};
			},
		};
		const tool = new SfQueryTool(SESSION, api);
		await tool.execute("c1", { query: "SELECT Id FROM Account", all_rows: true });
		expect(capturedArgs).toContain("--all-rows");
	});

	it("appends warning when query results are incomplete", async () => {
		const queryResult = JSON.stringify({
			status: 0,
			result: {
				totalSize: 50000,
				done: false,
				records: [{ attributes: { type: "Account" }, Name: "Partial" }],
			},
		});
		const api = mockApi([{ stdout: queryResult }]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT Name FROM Account" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("Warning");
		expect(text).toContain("incomplete");
		expect(text).toContain("sf data export bulk");
	});
});

// --- SfSetupTool set_default happy path ---

describe("SfSetupTool.execute() set_default", () => {
	it("calls sf config set target-org with alias", async () => {
		let capturedArgs: string[] = [];
		const api: SfExecApi = {
			async exec(_cmd: string, args: string[]): Promise<SfRawResult> {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		};
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "set_default", org: "my-prod" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("my-prod");
		expect(capturedArgs).toContain("config");
		expect(capturedArgs).toContain("set");
		expect(capturedArgs).toContain("target-org");
		expect(capturedArgs).toContain("my-prod");
		expect(capturedArgs).toContain("--global");
	});
});

// ─── SfToolDetails tool and action fields ────────────────────────────────────

describe("SfToolDetails.tool and action fields", () => {
	it("sf_setup status result has tool=sf_setup and action=status", async () => {
		const orgList = JSON.stringify({
			status: 0,
			result: { nonScratchOrgs: [], scratchOrgs: [], sandboxes: [], devHubs: [], other: [] },
		});
		const api = mockApi([{ stdout: orgList }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "status" });
		expect(result.details?.tool).toBe("sf_setup");
		expect(result.details?.action).toBe("status");
	});

	it("sf_query result has tool=sf_query and action=query", async () => {
		const queryPayload = JSON.stringify({
			status: 0,
			result: { totalSize: 0, done: true, records: [] },
		});
		const api = mockApi([{ stdout: queryPayload }]);
		const tool = new SfQueryTool(SESSION, api);
		const result = await tool.execute("c1", { query: "SELECT Id FROM Account" });
		expect(result.details?.tool).toBe("sf_query");
		expect(result.details?.action).toBe("query");
	});

	it("sf_org_display result has tool=sf_org_display", async () => {
		const displayPayload = JSON.stringify({
			status: 0,
			result: { id: "00D1", username: "u@test.com", instanceUrl: "https://x", connectedStatus: "Connected" },
		});
		const api = mockApi([{ stdout: displayPayload }]);
		const tool = new SfOrgDisplayTool(SESSION, api);
		const result = await tool.execute("c1", {});
		expect(result.details?.tool).toBe("sf_org_display");
	});
});
