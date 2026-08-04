import { describe, expect, test } from "bun:test";
import {
	EXPECTED_SUMMARY,
	MEDDPICC_STEPS,
	renderMeddpiccRunbook,
	type ScenarioObservation,
	SUMMARY_RANGE,
	validateMeddpiccStep,
} from "../scripts/uat/meddpicc-scenario";

const WORKSPACE = "/tmp/xcsh-meddpicc-demo";
const UNCHANGED_FILES = [{ path: "example-corp.json", sha256: "fixture-sha", bytes: 123 }];

function observation(overrides: Partial<ScenarioObservation> = {}): ScenarioObservation {
	return {
		reply: "",
		workspace: WORKSPACE,
		filesBefore: UNCHANGED_FILES,
		filesAfter: UNCHANGED_FILES,
		toolNotices: [],
		hostToolCalls: [],
		workbookBefore: { activeSheet: "Start", sheets: { Start: { "A1:B1": [["sentinel", "keep"]] } } },
		workbookAfter: { activeSheet: "Start", sheets: { Start: { "A1:B1": [["sentinel", "keep"]] } } },
		...overrides,
	};
}

function allPass(step: number, value: ScenarioObservation): void {
	const results = validateMeddpiccStep(step, value);
	expect(results.length).toBeGreaterThan(0);
	expect(results.filter(result => !result.passed)).toEqual([]);
}

describe("five-step MEDDPICC scenario", () => {
	test("owns the exact five presentation prompts and prints them from one source", () => {
		expect(MEDDPICC_STEPS).toHaveLength(5);
		const runbook = renderMeddpiccRunbook();
		for (const step of MEDDPICC_STEPS) expect(runbook).toContain(step.prompt);
	});

	test("step 1 proves cwd, fixture inventory, and no filesystem mutation", () => {
		allPass(1, observation({ reply: `Current working directory: ${WORKSPACE}\n- example-corp.json (MEDDPICC)` }));
	});

	test("step 1 accepts the equivalent macOS /tmp spelling", () => {
		allPass(
			1,
			observation({
				workspace: "/private/tmp/xcsh-meddpicc-demo",
				reply: "Current working directory: /tmp/xcsh-meddpicc-demo\n- example-corp.json (MEDDPICC)",
			}),
		);
	});

	test("step 2 proves the deterministic status contract", () => {
		allPass(
			2,
			observation({
				reply: "Example Corp schema is valid. Score 21/32, completion 65.6%, rating Yellow. Next incomplete: decisionProcess.",
				toolNotices: [{ tool: "bash", ok: true, detail: "bash: done" }],
			}),
		);
	});

	test("step 2 accepts the canonical fixture name as the account identifier", () => {
		allPass(
			2,
			observation({
				reply: "example-corp.json schema is valid. Score 21/32, completion 65.6%, rating Yellow. Next incomplete: decisionProcess.",
				toolNotices: [{ tool: "bash", ok: true, detail: "bash: done" }],
			}),
		);
	});

	test("step 3 proves installed-plugin schema access and all eight canonical elements", () => {
		allPass(
			3,
			observation({
				reply: "Metrics; Economic Buyer; Decision Criteria; Decision Process; Paper Process; Identify Pain; Champion; Competition — definitions read from xcsh://plugin/meddpicc/schema.",
				toolNotices: [{ tool: "read", ok: true, detail: "read: done" }],
			}),
		);
	});

	test("step 3 accepts the installed engine's Implicate the Pain display name", () => {
		allPass(
			3,
			observation({
				reply: "Metrics; Economic Buyer; Decision Criteria; Decision Process; Paper Process; Implicate the Pain; Champion; Competition — definitions from the installed plugin engine.",
				toolNotices: [{ tool: "bash", ok: true, detail: "bash: done" }],
			}),
		);
	});

	test("step 3 compares rendered Markdown text", () => {
		allPass(
			3,
			observation({
				reply: "**M**etrics; **E**conomic Buyer; **D**ecision Criteria; **D**ecision Process; **P**aper Process; **I**mplicate the Pain; **C**hampion; **C**ompetition — schema definitions.",
				toolNotices: [{ tool: "bash", ok: true, detail: "bash: done" }],
			}),
		);
	});

	test("step 3 accepts canonical schema keys", () => {
		allPass(
			3,
			observation({
				reply: "metrics; economicBuyer; decisionCriteria; decisionProcess; paperProcess; implicateThePain; champion; competition — schema definitions.",
				toolNotices: [{ tool: "read", ok: true, detail: "read: done" }],
			}),
		);
	});

	test("step 4 proves the three evidence-backed priority gaps without mutation", () => {
		expect(MEDDPICC_STEPS[3].prompt).toContain("eight MEDDPICC qualification elements");
		allPass(
			4,
			observation({
				reply: "Example Corp health review: Paper Process lacks procurement evidence; Decision Process lacks a complete approval path; Competition lacks a differentiation plan.",
				toolNotices: [{ tool: "read", ok: true, detail: "read: done" }],
			}),
		);
	});

	test("step 5 proves exact Excel round trips, one idempotent sheet, and Start preservation", () => {
		expect(MEDDPICC_STEPS[4].prompt).toContain("Call add_sheet with that name on every run");
		allPass(
			5,
			observation({
				reply: "Read back MEDDPICC — Example Corp A1:B7 with Example Corp, 21/32, 65.6%, and Yellow.",
				hostToolCalls: [
					{ toolName: "add_sheet", arguments: { name: "MEDDPICC — Example Corp" } },
					{
						toolName: "write_range",
						arguments: { address: SUMMARY_RANGE, values: EXPECTED_SUMMARY },
					},
					{ toolName: "read_range", arguments: { address: SUMMARY_RANGE } },
				],
				workbookAfter: {
					activeSheet: "Start",
					sheets: {
						Start: { "A1:B1": [["sentinel", "keep"]] },
						"MEDDPICC — Example Corp": { "A1:B7": EXPECTED_SUMMARY },
					},
				},
			}),
		);
	});

	test("step 5 rerun calls idempotent add_sheet and leaves one summary sheet", () => {
		const existingWorkbook = {
			activeSheet: "Start",
			sheets: {
				Start: { "A1:B1": [["sentinel", "keep"]] },
				"MEDDPICC — Example Corp": { "A1:B7": EXPECTED_SUMMARY },
			},
		};
		allPass(
			5,
			observation({
				reply: "Reused MEDDPICC — Example Corp and read back A1:B7 with 21/32.",
				hostToolCalls: [
					{ toolName: "get_workbook_info", arguments: {} },
					{ toolName: "add_sheet", arguments: { name: "MEDDPICC — Example Corp" } },
					{ toolName: "write_range", arguments: { address: SUMMARY_RANGE, values: EXPECTED_SUMMARY } },
					{ toolName: "read_range", arguments: { address: SUMMARY_RANGE } },
				],
				workbookBefore: existingWorkbook,
				workbookAfter: existingWorkbook,
			}),
		);
	});

	test("fails closed when a required status value is missing", () => {
		const results = validateMeddpiccStep(2, observation({ reply: "Example Corp is Yellow." }));
		expect(results.some(result => !result.passed && result.label.includes("21/32"))).toBe(true);
	});
});
