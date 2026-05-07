import { describe, expect, it } from "bun:test";
import {
	buildSalesforceHint,
	loadSalesforceContext,
	renderSalesforceContextMarkdown,
	type SalesforceContext,
	salesforceContextIsStale,
} from "../../src/internal-urls/salesforce-context";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fakeContext: SalesforceContext = {
	userId: "001FAKE000000001",
	username: "test@example.com",
	instanceUrl: "https://test.my.salesforce.com",
	orgAlias: "test-org",
	roleName: "AMER",
	managerId: "001FAKE000000002",
	managerName: "Test Manager",
	team: [
		{ id: "001FAKE000000003", name: "Alice Engineer", title: "Solutions Engineer" },
		{ id: "001FAKE000000004", name: "Bob Architect", title: "Sr Solutions Architect" },
	],
	territories: ["Territory Alpha", "Territory Beta"],
	productSegmentations: ["ELA", "Platform-Based"],
	useCaseCategories: ["Distributed Cloud"],
	forecastCategories: ["Pipeline", "Best Case", "Commit"],
	stages: ["Awareness", "Solution - Front Runner"],
	activeAccounts: [
		{ name: "Acme Corp", oppCount: 5 },
		{ name: "Globex Industries", oppCount: 3 },
		{ name: "Initech", oppCount: 1 },
	],
	customFields: {
		trueAcv: true,
		upsellAcv: true,
		productSegmentation: true,
		useCaseCategory: true,
		territory: true,
		renewal: true,
	},
	pipelineSummary: {
		byForecast: {
			Pipeline: { amount: 5_000_000, count: 40 },
			"Best Case": { amount: 1_200_000, count: 3 },
			Commit: { amount: 500_000, count: 2 },
		},
		total: 6_700_000,
		dealCount: 45,
	},
	teamRoles: ["Systems Engineer", "Solution Engineer"],
	collectedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// salesforceContextIsStale
// ---------------------------------------------------------------------------

describe("salesforceContextIsStale", () => {
	it("returns true when collectedAt is missing", () => {
		expect(salesforceContextIsStale({ collectedAt: "" } as SalesforceContext)).toBe(true);
	});

	it("returns true when older than 4 hours", () => {
		const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
		expect(salesforceContextIsStale({ ...fakeContext, collectedAt: old })).toBe(true);
	});

	it("returns false when recent", () => {
		expect(salesforceContextIsStale(fakeContext)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// buildSalesforceHint
// ---------------------------------------------------------------------------

describe("buildSalesforceHint", () => {
	it("returns undefined when ctx is null", () => {
		expect(buildSalesforceHint(null)).toBeUndefined();
	});

	it("returns undefined when pipelineSummary is missing", () => {
		const ctx = { ...fakeContext, pipelineSummary: undefined };
		expect(buildSalesforceHint(ctx)).toBeUndefined();
	});

	it("formats millions correctly", () => {
		const hint = buildSalesforceHint(fakeContext);
		expect(hint).toBeDefined();
		expect(hint!.pipelineTotal).toBe("$6.7M");
	});

	it("formats thousands correctly", () => {
		const ctx = {
			...fakeContext,
			pipelineSummary: { byForecast: {}, total: 500_000, dealCount: 5 },
		};
		const hint = buildSalesforceHint(ctx);
		expect(hint!.pipelineTotal).toBe("$500K");
	});

	it("formats small amounts correctly", () => {
		const ctx = {
			...fakeContext,
			pipelineSummary: { byForecast: {}, total: 750, dealCount: 1 },
		};
		const hint = buildSalesforceHint(ctx);
		expect(hint!.pipelineTotal).toBe("$750");
	});

	it("includes deal count and account count", () => {
		const hint = buildSalesforceHint(fakeContext);
		expect(hint!.dealCount).toBe(45);
		expect(hint!.accountCount).toBe(3);
	});

	it("includes top 3 territories comma-joined", () => {
		const hint = buildSalesforceHint(fakeContext);
		expect(hint!.territories).toBe("Territory Alpha, Territory Beta");
	});

	it("omits territories when none discovered", () => {
		const ctx = { ...fakeContext, territories: undefined };
		const hint = buildSalesforceHint(ctx);
		expect(hint!.territories).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// renderSalesforceContextMarkdown
// ---------------------------------------------------------------------------

describe("renderSalesforceContextMarkdown", () => {
	it("returns seed instructions when ctx is null", () => {
		const md = renderSalesforceContextMarkdown(null);
		expect(md).toContain("xcsh://salesforce?refresh=true");
		expect(md).toContain("No Salesforce context");
	});

	it("renders Pipeline Summary section", () => {
		const md = renderSalesforceContextMarkdown(fakeContext);
		expect(md).toContain("## Pipeline Summary");
		expect(md).toContain("Pipeline");
		expect(md).toContain("Best Case");
	});

	it("renders Active Accounts section", () => {
		const md = renderSalesforceContextMarkdown(fakeContext);
		expect(md).toContain("## Active Accounts");
		expect(md).toContain("Acme Corp");
		expect(md).toContain("Globex Industries");
	});

	it("renders Territories section", () => {
		const md = renderSalesforceContextMarkdown(fakeContext);
		expect(md).toContain("Territory Alpha");
		expect(md).toContain("Territory Beta");
	});

	it("renders Team section with names and titles", () => {
		const md = renderSalesforceContextMarkdown(fakeContext);
		expect(md).toContain("## Team");
		expect(md).toContain("Alice Engineer");
		expect(md).toContain("Solutions Engineer");
		expect(md).toContain("Test Manager");
	});

	it("renders Org Capabilities section", () => {
		const md = renderSalesforceContextMarkdown(fakeContext);
		expect(md).toContain("Org Capabilities");
	});

	it("omits sections when data is missing", () => {
		const minimal: SalesforceContext = {
			userId: "001FAKE",
			username: "test@example.com",
			instanceUrl: "https://test.sf.com",
			collectedAt: new Date().toISOString(),
		};
		const md = renderSalesforceContextMarkdown(minimal);
		expect(md).toContain("# Salesforce Context");
		expect(md).not.toContain("## Pipeline Summary");
		expect(md).not.toContain("## Active Accounts");
		expect(md).not.toContain("## Team");
	});

	it("includes collectedAt footer", () => {
		const md = renderSalesforceContextMarkdown(fakeContext);
		expect(md).toContain("Collected:");
	});
});

// ---------------------------------------------------------------------------
// loadSalesforceContext
// ---------------------------------------------------------------------------

describe("loadSalesforceContext", () => {
	it("returns null or a valid context without throwing", async () => {
		const ctx = await loadSalesforceContext();
		if (ctx !== null) {
			expect(ctx.userId).toBeString();
			expect(ctx.username).toBeString();
		}
	});

	it("return type matches SalesforceContext", async () => {
		const ctx = await loadSalesforceContext();
		if (ctx !== null) {
			expect(typeof ctx.collectedAt).toBe("string");
		}
	});
});
