import { describe, expect, test } from "bun:test";
import {
	EXPECTED_SUMMARY,
	extractPrivateStatusOracle,
	MEDDPICC_STEPS,
	PRIVATE_MEDDPICC_STEPS,
	renderMeddpiccRunbook,
	type ScenarioObservation,
	SUMMARY_RANGE,
	validateMeddpiccStep,
	validatePrivateMeddpiccStep,
	validatePrivateSummaryAgainstStatus,
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

describe("private in-place MEDDPICC scenario", () => {
	test("prompts never embed a customer filename or account name", () => {
		expect(PRIVATE_MEDDPICC_STEPS).toHaveLength(5);
		const prompts = PRIVATE_MEDDPICC_STEPS.map(step => step.prompt).join("\n");
		expect(prompts).not.toContain("example-corp.json");
		expect(prompts).not.toContain("Example Corp");
		expect(prompts).toContain("single top-level JSON");
	});

	test("status accepts live engine values without copying a synthetic numeric oracle", () => {
		const results = validatePrivateMeddpiccStep(
			2,
			observation({
				reply: "Schema valid. Score 25/32, completion 78.1%, rating Green. Next section: Paper Process.",
				toolNotices: [{ tool: "bash", ok: true, detail: "bash: done" }],
			}),
		);
		expect(results.filter(result => !result.passed)).toEqual([]);
	});

	test("health review requires three MEDDPICC elements and a fixture read", () => {
		const results = validatePrivateMeddpiccStep(
			4,
			observation({
				reply: "Paper Process lacks dates; Champion lacks evidence; Competition lacks differentiation.",
				toolNotices: [{ tool: "read", ok: true, detail: "read: done" }],
			}),
		);
		expect(results.filter(result => !result.passed)).toEqual([]);
	});

	test("Excel round trip validates live values structurally and remains idempotent", () => {
		const values = [
			["Metric", "Value"],
			["Account", "Private account"],
			["Score", "25/32"],
			["Completion", "78.1%"],
			["Rating", "Green"],
			["Next section", "Paper Process"],
			["Priority gaps", "Paper Process; Champion; Competition"],
		];
		const sheet = "MEDDPICC — Presentation";
		const range = `'${sheet}'!A1:B7`;
		const results = validatePrivateMeddpiccStep(
			5,
			observation({
				reply: "Read back A1:B7 successfully.",
				hostToolCalls: [
					{ toolName: "add_sheet", arguments: { name: sheet } },
					{ toolName: "write_range", arguments: { address: range, values } },
					{ toolName: "read_range", arguments: { address: range } },
				],
				workbookAfter: {
					activeSheet: "Start",
					sheets: { Start: { "A1:B1": [["sentinel", "keep"]] }, [sheet]: { "A1:B7": values } },
				},
			}),
		);
		expect(results.filter(result => !result.passed)).toEqual([]);
	});

	test("Excel summary score, completion, and rating must match the engine-backed status turn", () => {
		const status = extractPrivateStatusOracle(
			"Schema valid. Score 25 / 32, completion 78.1%, rating Green. Next section: Paper Process.",
		);
		expect(status).toEqual({ score: "25/32", completion: "78.1%", rating: "green" });
		const values = [
			["Metric", "Value"],
			["Account", "Private account"],
			["Score", "25/32"],
			["Completion", "78.1%"],
			["Rating", "Green"],
			["Next section", "Paper Process"],
			["Priority gaps", "Paper Process; Champion; Competition"],
		];
		const matching = validatePrivateSummaryAgainstStatus(
			[{ toolName: "write_range", arguments: { values } }],
			status,
		);
		expect(matching.passed).toBe(true);

		values[2][1] = "24/32";
		const mismatched = validatePrivateSummaryAgainstStatus(
			[{ toolName: "write_range", arguments: { values } }],
			status,
		);
		expect(mismatched.passed).toBe(false);
	});

	test("private Excel summary fails closed unless it contains exactly three priority gaps", () => {
		const values = [
			["Metric", "Value"],
			["Account", "Private account"],
			["Score", "25/32"],
			["Completion", "78.1%"],
			["Rating", "Green"],
			["Next section", "Paper Process"],
			["Priority gaps", "Paper Process; Champion"],
		];
		const sheet = "MEDDPICC — Presentation";
		const results = validatePrivateMeddpiccStep(
			5,
			observation({
				reply: "Read back A1:B7 successfully.",
				hostToolCalls: [
					{ toolName: "add_sheet", arguments: { name: sheet } },
					{ toolName: "write_range", arguments: { address: `'${sheet}'!A1:B7`, values } },
					{ toolName: "read_range", arguments: { address: `'${sheet}'!A1:B7` } },
				],
				workbookAfter: {
					activeSheet: "Start",
					sheets: { Start: { "A1:B1": [["sentinel", "keep"]] }, [sheet]: { "A1:B7": values } },
				},
			}),
		);
		expect(results.some(result => !result.passed && result.label.includes("three priority gaps"))).toBe(true);
	});
});
