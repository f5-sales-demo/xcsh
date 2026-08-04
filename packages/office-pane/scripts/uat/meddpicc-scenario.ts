import type { UatHostToolCall, UatToolNotice } from "./bridge-client";

export const SUMMARY_SHEET = "MEDDPICC — Example Corp";
export const SUMMARY_RANGE = `'${SUMMARY_SHEET}'!A1:B7`;

export const EXPECTED_SUMMARY: string[][] = [
	["Metric", "Value"],
	["Account", "Example Corp"],
	["Score", "21/32"],
	["Completion", "65.6%"],
	["Rating", "Yellow"],
	["Next section", "Decision Process"],
	["Priority gaps", "Paper Process; Decision Process; Competition"],
];

export const CANONICAL_ELEMENTS = [
	"Metrics",
	"Economic Buyer",
	"Decision Criteria",
	"Decision Process",
	"Paper Process",
	"Identify Pain",
	"Champion",
	"Competition",
] as const;

export interface MeddpiccStep {
	number: number;
	title: string;
	prompt: string;
	readOnly: boolean;
}

export const MEDDPICC_STEPS: MeddpiccStep[] = [
	{
		number: 1,
		title: "Prove the working folder and fixture",
		prompt:
			"Report your current working directory. Then inventory the MEDDPICC-related files in this folder only. Do not modify anything.",
		readOnly: true,
	},
	{
		number: 2,
		title: "Run the installed MEDDPICC status command",
		prompt: "/meddpicc:meddpicc-status",
		readOnly: true,
	},
	{
		number: 3,
		title: "Read all eight schema-derived definitions",
		prompt:
			"Using the installed MEDDPICC plugin—not general knowledge—show the schema-derived definitions for all eight qualification elements. Do not modify files or the workbook.",
		readOnly: true,
	},
	{
		number: 4,
		title: "Review the three priority gaps",
		prompt:
			"Read example-corp.json and give a read-only Example Corp health review. Within the eight MEDDPICC qualification elements, identify the three most urgent evidence-backed gaps and cite the evidence that makes each a gap. Do not modify anything.",
		readOnly: true,
	},
	{
		number: 5,
		title: "Create and verify the idempotent Excel summary",
		prompt:
			"Create or update a worksheet named MEDDPICC — Example Corp. Call add_sheet with that name on every run; the tool is idempotent and reports when the sheet already exists. Write this exact two-column executive summary to A1:B7: [Metric, Value], [Account, Example Corp], [Score, 21/32], [Completion, 65.6%], [Rating, Yellow], [Next section, Decision Process], [Priority gaps, Paper Process; Decision Process; Competition]. Read A1:B7 back and report it. Reuse the sheet if it exists and do not modify any other sheet.",
		readOnly: false,
	},
];

export interface FileSnapshotEntry {
	path: string;
	sha256: string;
	bytes: number;
}

export interface WorkbookSnapshot {
	activeSheet: string;
	sheets: Record<string, Record<string, unknown[][]>>;
}

export interface ScenarioObservation {
	reply: string;
	workspace: string;
	filesBefore: FileSnapshotEntry[];
	filesAfter: FileSnapshotEntry[];
	toolNotices: UatToolNotice[];
	hostToolCalls: Array<Pick<UatHostToolCall, "toolName" | "arguments">>;
	workbookBefore: WorkbookSnapshot;
	workbookAfter: WorkbookSnapshot;
}

export interface ScenarioAssertion {
	label: string;
	passed: boolean;
	detail?: string;
}

function assertion(label: string, passed: boolean, detail?: string): ScenarioAssertion {
	return { label, passed, ...(detail ? { detail } : {}) };
}

function includes(reply: string, text: string): boolean {
	return reply.toLocaleLowerCase().includes(text.toLocaleLowerCase());
}

function unchangedFiles(observation: ScenarioObservation): boolean {
	return JSON.stringify(observation.filesBefore) === JSON.stringify(observation.filesAfter);
}

function successfulTool(observation: ScenarioObservation, names: string[]): boolean {
	return observation.toolNotices.some(notice => notice.ok && names.includes(notice.tool));
}

function exactStartSheet(observation: ScenarioObservation): boolean {
	return (
		JSON.stringify(observation.workbookBefore.sheets.Start) === JSON.stringify(observation.workbookAfter.sheets.Start)
	);
}

function unchangedWorkbook(observation: ScenarioObservation): boolean {
	return JSON.stringify(observation.workbookBefore) === JSON.stringify(observation.workbookAfter);
}

export function validateMeddpiccStep(stepNumber: number, observation: ScenarioObservation): ScenarioAssertion[] {
	const reply = observation.reply;
	switch (stepNumber) {
		case 1:
			return [
				assertion("reply contains the exact demo directory", reply.includes(observation.workspace)),
				assertion("reply inventories example-corp.json", includes(reply, "example-corp.json")),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		case 2:
			return [
				assertion(
					"reply identifies Example Corp",
					includes(reply, "Example Corp") || includes(reply, "example-corp.json"),
				),
				assertion("reply reports a valid schema", includes(reply, "schema") && includes(reply, "valid")),
				assertion("reply reports 21/32", includes(reply, "21/32")),
				assertion("reply reports 65.6%", includes(reply, "65.6%")),
				assertion("reply reports Yellow", includes(reply, "Yellow")),
				assertion("reply reports decisionProcess", includes(reply.replaceAll(" ", ""), "decisionProcess")),
				assertion("status command used the installed plugin engine", successfulTool(observation, ["bash", "read"])),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		case 3:
			return [
				...CANONICAL_ELEMENTS.map(element =>
					assertion(
						`reply defines ${element}`,
						element === "Identify Pain"
							? includes(reply, "Identify Pain") || includes(reply, "Implicate the Pain")
							: includes(reply, element),
					),
				),
				assertion("installed plugin resource was read", successfulTool(observation, ["read", "bash"])),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		case 4:
			return [
				assertion("reply identifies Paper Process", includes(reply, "Paper Process")),
				assertion("reply identifies Decision Process", includes(reply, "Decision Process")),
				assertion("reply identifies Competition", includes(reply, "Competition")),
				assertion("fixture was read", successfulTool(observation, ["read", "bash"])),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		case 5: {
			const calls = observation.hostToolCalls;
			const add = calls.find(call => call.toolName === "add_sheet");
			const write = calls.find(call => call.toolName === "write_range");
			const read = calls.find(call => call.toolName === "read_range");
			const summarySheets = Object.keys(observation.workbookAfter.sheets).filter(name => name === SUMMARY_SHEET);
			return [
				assertion("add_sheet targeted the Example Corp summary", add?.arguments.name === SUMMARY_SHEET),
				assertion(
					"write_range targeted A1:B7 with the exact summary",
					write?.arguments.address === SUMMARY_RANGE &&
						JSON.stringify(write.arguments.values) === JSON.stringify(EXPECTED_SUMMARY),
				),
				assertion("read_range read A1:B7 back", read?.arguments.address === SUMMARY_RANGE),
				assertion(
					"workbook contains the exact summary values",
					JSON.stringify(observation.workbookAfter.sheets[SUMMARY_SHEET]?.["A1:B7"]) ===
						JSON.stringify(EXPECTED_SUMMARY),
				),
				assertion("the Start sheet is still active", observation.workbookAfter.activeSheet === "Start"),
				assertion("the Start sentinel sheet is unchanged", exactStartSheet(observation)),
				assertion("there is exactly one summary sheet", summarySheets.length === 1),
				assertion("assistant reports the read-back", includes(reply, "A1:B7") && includes(reply, "21/32")),
			];
		}
		default:
			return [assertion(`known scenario step ${stepNumber}`, false)];
	}
}

/** Print the same prompts used by automation as a five-step presentation runbook. */
export function renderMeddpiccRunbook(): string {
	return MEDDPICC_STEPS.map(step => `${step.number}. ${step.title}\n\n${step.prompt}`).join("\n\n");
}
