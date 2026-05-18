import { describe, expect, it } from "bun:test";
import { getThemeByName } from "../../src/modes/theme/theme";
import type { SfToolDetails } from "../../src/tools/sf";
import { sfToolRenderer } from "../../src/tools/sf-renderer";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

const WIDTH = 120;

// ─── renderCall ──────────────────────────────────────────────────────────────

describe("sfToolRenderer renderCall", () => {
	it("shows Salesforce title and action for sf_setup", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = sfToolRenderer.renderCall({ action: "status" }, { expanded: false, isPartial: true }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Salesforce");
		expect(rendered).toContain("status");
	});

	it("shows query for sf_query renderCall", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = sfToolRenderer.renderCall(
			{ query: "SELECT Id FROM Account" },
			{ expanded: false, isPartial: true },
			theme!,
		);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Salesforce");
		expect(rendered).toContain("query");
	});
});

// ─── renderResult: sf_setup status ───────────────────────────────────────────

describe("sfToolRenderer renderResult: sf_setup status", () => {
	it("renders bordered block with Salesforce title", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_setup",
			action: "status",
			orgs: [
				{
					alias: "f5-prod",
					username: "user@f5.com",
					orgId: "00D000001",
					instanceUrl: "https://f5.salesforce.com",
					connectedStatus: "Connected",
					isDefault: true,
					isSandbox: false,
				},
			],
		};
		const result = { content: [{ type: "text", text: "| f5-prod | user@f5.com |" }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Salesforce");
		expect(rendered).toContain("status");
		expect(rendered).toContain("f5-prod");
		expect(rendered).toContain("user@f5.com");
		expect(rendered).toContain("Connected");
		expect(rendered).toContain("(default)");
	});

	it("renders sandbox badge for sandbox orgs", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_setup",
			action: "list_orgs",
			orgs: [
				{
					alias: "sb1",
					username: "user@f5.com.sb1",
					orgId: "00D000002",
					instanceUrl: "https://f5--sb1.salesforce.com",
					connectedStatus: "Connected",
					isDefault: false,
					isSandbox: true,
				},
			],
		};
		const result = { content: [{ type: "text", text: "" }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("sandbox");
	});

	it("renders empty org list message when no orgs", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = { tool: "sf_setup", action: "status", orgs: [] };
		const result = { content: [{ type: "text", text: "No authenticated orgs found." }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("No authenticated orgs");
	});
});

// ─── renderResult: sf_query ───────────────────────────────────────────────────

describe("sfToolRenderer renderResult: sf_query", () => {
	it("renders query header with record count", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_query",
			action: "query",
			queryResult: {
				totalSize: 2,
				done: true,
				records: [
					{ attributes: { type: "Account" }, Name: "Acme", Industry: "Tech" },
					{ attributes: { type: "Account" }, Name: "Globex", Industry: "Finance" },
				],
			},
		};
		const result = {
			content: [{ type: "text", text: "2 records returned.\n\n| Name | Industry |\n|---|\n| Acme | Tech |" }],
			details,
		};
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Salesforce");
		expect(rendered).toContain("query");
		expect(rendered).toContain("2 record");
		expect(rendered).toContain("Acme");
		expect(rendered).toContain("Globex");
		expect(rendered).not.toContain("attributes");
	});

	it("shows incomplete warning when done is false", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_query",
			action: "query",
			queryResult: {
				totalSize: 50000,
				done: false,
				records: [{ attributes: { type: "Account" }, Name: "Partial" }],
			},
		};
		const result = { content: [{ type: "text", text: "50000 records returned." }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("incomplete");
	});
});

// ─── renderResult: sf_org_display ────────────────────────────────────────────

describe("sfToolRenderer renderResult: sf_org_display", () => {
	it("renders key-value org summary", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_org_display",
			orgs: [
				{
					alias: "devSandbox",
					username: "dev@example.com.sandbox",
					orgId: "00Dxx0000001gER",
					instanceUrl: "https://example.sandbox.my.salesforce.com",
					connectedStatus: "Connected",
					isDefault: false,
					isSandbox: true,
				},
			],
		};
		const result = {
			content: [{ type: "text", text: "**devSandbox**\nUsername: dev@example.com.sandbox" }],
			details,
		};
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("devSandbox");
		expect(rendered).toContain("dev@example.com.sandbox");
		expect(rendered).toContain("Connected");
		expect(rendered).toContain("Sandbox");
	});
});

// ─── renderResult: errors ────────────────────────────────────────────────────

describe("sfToolRenderer renderResult: error states", () => {
	it("renders error block with guidance for session_expired", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_setup",
			action: "status",
			errorType: "session_expired",
		};
		const result = {
			content: [{ type: "text", text: "Salesforce session expired." }],
			details,
			isError: true,
		};
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("session_expired");
		expect(rendered).toContain("Re-authenticate");
	});

	it("renders error block with guidance for auth_required", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_setup",
			action: "login",
			errorType: "auth_required",
		};
		const result = {
			content: [{ type: "text", text: "No authenticated orgs." }],
			details,
			isError: true,
		};
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Authenticate");
		expect(rendered).toContain("sf org login web");
	});

	it("renders error block with guidance for invalid_query", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_query",
			action: "query",
			errorType: "invalid_query",
		};
		const result = {
			content: [{ type: "text", text: "MALFORMED_QUERY: unexpected token" }],
			details,
			isError: true,
		};
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("invalid_query");
		expect(rendered).toContain("EntityDefinition");
	});

	it("falls back gracefully when details is undefined on error", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Something went wrong." }],
			isError: true,
		};
		const component = sfToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Something went wrong");
	});
});

// ─── mergeCallAndResult / inline flags ───────────────────────────────────────

describe("sfToolRenderer metadata flags", () => {
	it("has mergeCallAndResult set to true", () => {
		expect(sfToolRenderer.mergeCallAndResult).toBe(true);
	});

	it("has inline set to true", () => {
		expect(sfToolRenderer.inline).toBe(true);
	});
});
