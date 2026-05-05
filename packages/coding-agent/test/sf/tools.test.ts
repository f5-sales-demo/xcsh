import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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

	it("propagates SOQL errors with query context", async () => {
		const errorResult = JSON.stringify({
			status: 1,
			result: null,
			message: "MALFORMED_QUERY: unexpected token",
		});
		const api = mockApi([{ stdout: errorResult }]);
		const tool = new SfQueryTool(SESSION, api);
		await expect(tool.execute("c1", { query: "SELECT * FROM" })).rejects.toThrow("MALFORMED_QUERY");
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

// --- SfSetupTool.execute() profile action with relationship edge cases ---

describe("SfSetupTool.execute() profile", () => {
	let tmpDir: string;
	let originalHome: string | undefined;
	let originalSfHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-profile-test-"));
		originalHome = process.env.HOME;
		originalSfHome = process.env.SF_HOME;
		process.env.HOME = tmpDir;
		delete process.env.SF_HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalSfHome === undefined) {
			delete process.env.SF_HOME;
		} else {
			process.env.SF_HOME = originalSfHome;
		}
		await fs.rm(tmpDir, { recursive: true, force: true });
	});
	it("extracts relationship fields from nested objects", async () => {
		// Mock: first call = org display, second call = data query
		const orgDisplay = JSON.stringify({
			status: 0,
			result: { username: "u@test.com" },
		});
		const userQuery = JSON.stringify({
			status: 0,
			result: {
				totalSize: 1,
				done: true,
				records: [
					{
						Id: "005001",
						Username: "u@test.com",
						FirstName: "Jane",
						LastName: "Doe",
						Email: "jane@test.com",
						Manager: { Name: "Boss Man", Email: "boss@test.com" },
						UserRole: { Name: "Admin" },
						Profile: { Name: "System Administrator" },
					},
				],
			},
		});
		const api = mockApi([{ stdout: orgDisplay }, { stdout: userQuery }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "profile" });
		expect(result.details?.profile?.managerName).toBe("Boss Man");
		expect(result.details?.profile?.managerEmail).toBe("boss@test.com");
		expect(result.details?.profile?.role).toBe("Admin");
		expect(result.details?.profile?.profile).toBe("System Administrator");
	});

	it("handles null relationship fields gracefully", async () => {
		const orgDisplay = JSON.stringify({
			status: 0,
			result: { username: "u@test.com" },
		});
		const userQuery = JSON.stringify({
			status: 0,
			result: {
				totalSize: 1,
				done: true,
				records: [
					{
						Id: "005002",
						Username: "u@test.com",
						FirstName: "Solo",
						LastName: "User",
						Email: "solo@test.com",
						Manager: null,
						UserRole: null,
						Profile: null,
					},
				],
			},
		});
		const api = mockApi([{ stdout: orgDisplay }, { stdout: userQuery }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "profile" });
		expect(result.details?.profile?.managerName).toBeUndefined();
		expect(result.details?.profile?.role).toBeUndefined();
		expect(result.details?.profile?.firstName).toBe("Solo");
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

// --- SfSetupTool.execute() profile caching round-trip ---

describe("SfSetupTool.execute() profile caching", () => {
	let tmpDir: string;
	let originalHome: string | undefined;
	let originalSfHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-profile-cache-test-"));
		originalHome = process.env.HOME;
		originalSfHome = process.env.SF_HOME;
		process.env.HOME = tmpDir;
		delete process.env.SF_HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalSfHome === undefined) {
			delete process.env.SF_HOME;
		} else {
			process.env.SF_HOME = originalSfHome;
		}
		await fs.rm(tmpDir, { recursive: true, force: true });
	});
	it("returns profile details in result", async () => {
		const orgDisplay = JSON.stringify({
			status: 0,
			result: { username: "cache@test.com" },
		});
		const userQuery = JSON.stringify({
			status: 0,
			result: {
				totalSize: 1,
				done: true,
				records: [
					{
						Id: "005cache",
						Username: "cache@test.com",
						FirstName: "Cache",
						LastName: "Test",
						Email: "cache@test.com",
						Title: "Engineer",
						Department: "R&D",
					},
				],
			},
		});
		const api = mockApi([{ stdout: orgDisplay }, { stdout: userQuery }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "profile" });
		const profile = result.details?.profile;
		expect(profile).toBeDefined();
		expect(profile?.userId).toBe("005cache");
		expect(profile?.firstName).toBe("Cache");
		expect(profile?.title).toBe("Engineer");
		expect(profile?.department).toBe("R&D");
		expect(profile?.fetchedAt).toBeDefined();
		// Verify formatted output includes the name
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("Cache Test");
		expect(text).toContain("Engineer");
	});

	it("returns error when no user record found", async () => {
		const orgDisplay = JSON.stringify({ status: 0, result: { username: "ghost@test.com" } });
		const emptyQuery = JSON.stringify({
			status: 0,
			result: { totalSize: 0, done: true, records: [] },
		});
		const api = mockApi([{ stdout: orgDisplay }, { stdout: emptyQuery }]);
		const tool = new SfSetupTool(SESSION, api);
		const result = await tool.execute("c1", { action: "profile" });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("No user record found");
	});
});
