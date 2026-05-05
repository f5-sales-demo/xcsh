import { describe, expect, it } from "bun:test";
import {
	flattenRecord,
	formatOrgDetail,
	formatOrgTable,
	formatQueryResults,
	formatUserProfile,
} from "../../src/tools/sf/formatters";
import type { SfOrg, SfQueryResult, SfUserProfile } from "../../src/tools/sf/types";

describe("formatOrgTable", () => {
	it("returns message for empty array", () => {
		const result = formatOrgTable([]);
		expect(result).toContain("No authenticated orgs");
	});

	it("formats two orgs with default and sandbox markers", () => {
		const orgs: SfOrg[] = [
			{
				alias: "f5-prod",
				username: "user@f5.com",
				orgId: "00D000000000001",
				instanceUrl: "https://f5.salesforce.com",
				connectedStatus: "Connected",
				isDefault: true,
				isSandbox: false,
			},
			{
				alias: "sandbox",
				username: "user@f5.com.sandbox",
				orgId: "00D000000000002",
				instanceUrl: "https://f5--sandbox.salesforce.com",
				connectedStatus: "Connected",
				isDefault: false,
				isSandbox: true,
			},
		];
		const result = formatOrgTable(orgs);
		expect(result).toContain("f5");
		expect(result).toContain("(default)");
		expect(result).toContain("sandbox");
	});
});

describe("formatOrgDetail", () => {
	it("contains required fields and does not expose accessToken", () => {
		const org: SfOrg = {
			alias: "my-org",
			username: "admin@example.com",
			orgId: "00D123456789ABC",
			instanceUrl: "https://example.salesforce.com",
			connectedStatus: "Connected",
			isDefault: false,
			isSandbox: false,
		};
		const result = formatOrgDetail(org);
		expect(result).toContain("admin@example.com");
		expect(result).toContain("00D123456789ABC");
		expect(result).toContain("Connected");
		expect(result).not.toContain("accessToken");
	});
});

describe("flattenRecord", () => {
	it("strips top-level attributes key", () => {
		const record = {
			attributes: { type: "Contact", url: "/services/data/v58.0/sobjects/Contact/001" },
			Name: "Robin",
		};
		const result = flattenRecord(record);
		expect(result).not.toHaveProperty("attributes");
		expect(result).toHaveProperty("Name", "Robin");
	});

	it("flattens nested relationship and strips nested attributes", () => {
		const record = {
			Id: "001",
			Account: {
				attributes: { type: "Account", url: "/services/data/v58.0/sobjects/Account/001" },
				Name: "Acme",
			},
		};
		const result = flattenRecord(record);
		expect(result["Account.Name"]).toBe("Acme");
		expect("Account" in result).toBe(false);
		expect("Account.attributes" in result).toBe(false);
	});

	it("skips null values to prevent relationship column pollution", () => {
		const record = {
			Id: "001",
			Account: null,
			Name: "Test Case",
		};
		const result = flattenRecord(record);
		expect(result).not.toHaveProperty("Account");
		expect(result).toHaveProperty("Id", "001");
		expect(result).toHaveProperty("Name", "Test Case");
	});

	it("produces consistent columns across null and non-null relationships", () => {
		const records = [
			{ Id: "001", Account: null, CaseNumber: "00001" },
			{
				Id: "002",
				Account: { attributes: { type: "Account" }, Name: "Acme" },
				CaseNumber: "00002",
			},
		];
		const flat = records.map(r => flattenRecord(r));
		expect("Account" in flat[0]).toBe(false);
		expect(flat[1]["Account.Name"]).toBe("Acme");
		expect("Account" in flat[1]).toBe(false);
	});
});

describe("formatQueryResults", () => {
	it("renders markdown table for records with attributes", () => {
		const result: SfQueryResult = {
			totalSize: 2,
			done: true,
			records: [
				{
					attributes: { type: "Account" },
					Name: "Acme",
					Industry: "Technology",
				},
				{
					attributes: { type: "Account" },
					Name: "Globex",
					Industry: "Manufacturing",
				},
			],
		};
		const output = formatQueryResults(result);
		expect(output).toContain("2 records");
		expect(output).toContain("Acme");
		expect(output).toContain("Globex");
		expect(output).not.toContain("attributes");
	});

	it("returns message for empty records", () => {
		const result: SfQueryResult = {
			totalSize: 0,
			done: true,
			records: [],
		};
		const output = formatQueryResults(result);
		expect(output).toContain("No records");
	});

	it("renders consistent columns when mixing null and non-null relationships", () => {
		const result: SfQueryResult = {
			totalSize: 2,
			done: true,
			records: [
				{ attributes: { type: "Case" }, CaseNumber: "001", Account: null },
				{
					attributes: { type: "Case" },
					CaseNumber: "002",
					Account: { attributes: { type: "Account" }, Name: "Acme" },
				},
			],
		};
		const output = formatQueryResults(result);
		// Should have Account.Name column, NOT bare Account column
		expect(output).toContain("Account.Name");
		expect(output).not.toMatch(/\| Account \|/);
	});
});

describe("formatUserProfile", () => {
	it("contains name, title, and manager", () => {
		const profile: SfUserProfile = {
			userId: "005000000000001",
			username: "robin@example.com",
			firstName: "Robin",
			lastName: "Mordasiewicz",
			email: "robin@example.com",
			title: "Sr Solutions Engineer",
			managerName: "Paul Slosberg",
			managerEmail: "paul@example.com",
			fetchedAt: new Date().toISOString(),
		};
		const result = formatUserProfile(profile);
		expect(result).toContain("Robin Mordasiewicz");
		expect(result).toContain("Sr Solutions Engineer");
		expect(result).toContain("Paul Slosberg");
	});
});

describe("formatOrgTable edge cases", () => {
	it("shows (none) for org without alias", () => {
		const orgs: SfOrg[] = [
			{
				username: "user@test.com",
				orgId: "00D001",
				instanceUrl: "https://test.salesforce.com",
				connectedStatus: "Connected",
				isDefault: false,
				isSandbox: false,
			},
		];
		const result = formatOrgTable(orgs);
		expect(result).toContain("(none)");
		expect(result).toContain("user@test.com");
	});

	it("marks default org with no alias as (none) (default)", () => {
		const orgs: SfOrg[] = [
			{
				username: "admin@prod.com",
				orgId: "00D002",
				instanceUrl: "https://prod.salesforce.com",
				connectedStatus: "Connected",
				isDefault: true,
				isSandbox: false,
			},
		];
		const result = formatOrgTable(orgs);
		expect(result).toContain("(none) (default)");
	});

	it("handles org that is both default and sandbox", () => {
		const orgs: SfOrg[] = [
			{
				alias: "sb1",
				username: "user@test.com.sb1",
				orgId: "00D003",
				instanceUrl: "https://test--sb1.salesforce.com",
				connectedStatus: "Connected",
				isDefault: true,
				isSandbox: true,
			},
		];
		const result = formatOrgTable(orgs);
		expect(result).toContain("sb1 (default)");
		expect(result).toContain("user@test.com.sb1");
	});
});
