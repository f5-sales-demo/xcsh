import { describe, expect, it } from "bun:test";
import { getThemeByName } from "../../src/modes/theme/theme";
import type { PipelineReportData } from "../../src/pipeline-report/types";
import type { SfToolDetails } from "../../src/tools/sf";
import { sfToolRenderer } from "../../src/tools/sf-renderer";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

const WIDTH = 120;

function mockPipelineReport(): PipelineReportData {
	return {
		generated: "2026-05-20T12:00:00Z",
		quarter: { start: "2026-05-01", end: "2026-07-31" },
		territories: ["AMER: Major Accounts FinSvcs Red 9"],
		teamMembers: ["Robin Mordasiewicz", "Jane Doe"],
		netNew: {
			accounts: [{ name: "Acme Corp", territory: "AMER", platform: 500000, shape: 100000, other: 0 }],
			totals: { platform: 500000, shape: 100000, other: 0 },
			quotaTotal: 600000,
		},
		booked: {
			accounts: [{ name: "Globex", territory: "AMER", platform: 200000, shape: 0, other: 0 }],
			totals: { platform: 200000, shape: 0, other: 0 },
			quotaTotal: 200000,
		},
		renewals: {
			accounts: [],
			totals: { platform: 0, shape: 0, other: 0 },
			quotaTotal: 0,
		},
		forecast: { commit: 300000, bestCase: 200000, pipeline: 100000 },
		lineItemCount: 15,
		skusFound: ["F5-XC-WAF", "F5-SHP-BOT"],
		anomalies: [
			{ severity: "warning", category: "slipped-close-date", message: "2 accounts have slipped close dates" },
		],
		topDeals: [
			{
				oppId: "006abc",
				name: "Acme WAF Deal",
				accountName: "Acme Corp",
				stage: "Solution - Front Runner",
				closeDate: "2026-06-30",
				forecast: "Commit",
				amount: 300000,
				ownerName: "Jane Doe",
			},
		],
		closeDistribution: [
			{
				label: "June 2026",
				yearMonth: "2026-06",
				amount: 400000,
				commit: 300000,
				bestCase: 100000,
				pipeline: 0,
				oppCount: 3,
			},
		],
	};
}

describe("sfToolRenderer renderCall: sf_pipeline_report", () => {
	it("shows 'pipeline report' description when no args", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = sfToolRenderer.renderCall({}, { expanded: false, isPartial: true }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Salesforce");
		expect(rendered).toContain("pipeline report");
	});
});

describe("sfToolRenderer renderResult: sf_pipeline_report", () => {
	it("renders forecast summary and report sections", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = {
			tool: "sf_pipeline_report",
			pipelineReport: mockPipelineReport(),
		};
		const result = {
			content: [{ type: "text", text: "# F5 Distributed Cloud Pipeline Report\n\n**Generated:** 2026-05-20" }],
			details,
		};
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Salesforce");
		expect(rendered).toContain("pipeline report");
		expect(rendered).toContain("15 items");
		expect(rendered).toContain("Commit");
		expect(rendered).toContain("$300K");
		expect(rendered).toContain("Best Case");
		expect(rendered).toContain("Pipeline Report");
	});

	it("renders anomalies section when anomalies present", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const data = mockPipelineReport();
		const details: SfToolDetails = { tool: "sf_pipeline_report", pipelineReport: data };
		const result = { content: [{ type: "text", text: "report content" }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("1 anomalies");
		expect(rendered).toContain("slipped close dates");
	});

	it("renders without anomalies section when none", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const data = mockPipelineReport();
		data.anomalies = [];
		const details: SfToolDetails = { tool: "sf_pipeline_report", pipelineReport: data };
		const result = { content: [{ type: "text", text: "report content" }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).not.toContain("anomalies");
		expect(rendered).not.toContain("Anomalies");
	});

	it("falls back gracefully when pipelineReport is undefined", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: SfToolDetails = { tool: "sf_pipeline_report" };
		const result = { content: [{ type: "text", text: "Some fallback text" }], details };
		const component = sfToolRenderer.renderResult(result, { expanded: false, isPartial: false }, theme!);
		const rendered = stripAnsi(component.render(WIDTH).join("\n"));
		expect(rendered).toContain("Some fallback text");
	});
});
