import { describe, expect, it } from "bun:test";
import { deriveQueryLabel } from "../../src/tools/sf/formatters";

describe("deriveQueryLabel", () => {
	it("returns 'query' for empty string", () => {
		expect(deriveQueryLabel("")).toBe("query");
	});

	it("extracts object name from simple SELECT", () => {
		expect(deriveQueryLabel("SELECT Id FROM Account")).toBe("accounts");
	});

	it("returns lowercase name for unknown objects", () => {
		expect(deriveQueryLabel("SELECT Id FROM CustomObj__c")).toBe("customobj__c");
	});

	it("detects forecast breakdown", () => {
		const soql = "SELECT ForecastCategoryName, SUM(Amount) FROM Opportunity GROUP BY ForecastCategoryName";
		expect(deriveQueryLabel(soql)).toBe("forecast breakdown");
	});

	it("detects closed-won opportunities", () => {
		const soql = "SELECT Name FROM Opportunity WHERE IsWon = true AND CloseDate = THIS_FISCAL_QUARTER";
		expect(deriveQueryLabel(soql)).toBe("closed-won opportunities (this quarter)");
	});

	it("detects open opportunities with quarter scope", () => {
		const soql = "SELECT Name FROM Opportunity WHERE IsClosed = false AND CloseDate = THIS_FISCAL_QUARTER";
		expect(deriveQueryLabel(soql)).toBe("open opportunities (this quarter)");
	});

	it("detects last quarter scope", () => {
		const soql = "SELECT Name FROM Opportunity WHERE CloseDate = LAST_FISCAL_QUARTER";
		expect(deriveQueryLabel(soql)).toBe("opportunities (last quarter)");
	});

	it("detects next quarter scope", () => {
		const soql = "SELECT Name FROM Opportunity WHERE CloseDate = NEXT_FISCAL_QUARTER";
		expect(deriveQueryLabel(soql)).toBe("opportunities (next quarter)");
	});

	it("detects fiscal year scope", () => {
		const soql = "SELECT Name FROM Opportunity WHERE IsWon = true AND CloseDate = THIS_FISCAL_YEAR";
		expect(deriveQueryLabel(soql)).toBe("closed-won opportunities (this year)");
	});

	it("detects GROUP BY summary without ForecastCategoryName", () => {
		const soql = "SELECT Account.Name, SUM(Amount) FROM Opportunity GROUP BY Account.Name";
		expect(deriveQueryLabel(soql)).toBe("opportunities summary");
	});

	it("maps OpportunityLineItem to 'line items'", () => {
		expect(deriveQueryLabel("SELECT Id FROM OpportunityLineItem")).toBe("line items");
	});

	it("maps Case to 'cases'", () => {
		expect(deriveQueryLabel("SELECT Id FROM Case WHERE IsClosed = false")).toBe("open cases");
	});

	it("detects renewals", () => {
		const soql = "SELECT Name FROM Opportunity WHERE Type = 'Renewal' AND IsClosed = false";
		expect(deriveQueryLabel(soql)).toBe("open renewals opportunities");
	});
});
