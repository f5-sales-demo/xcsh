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

export const PRIVATE_SUMMARY_SHEET = "MEDDPICC — Presentation";
export const PRIVATE_SUMMARY_RANGE = `'${PRIVATE_SUMMARY_SHEET}'!A1:B7`;
const PRIVATE_SUMMARY_LABELS = ["Metric", "Account", "Score", "Completion", "Rating", "Next section", "Priority gaps"];

/**
 * Customer-data UAT prompts identify the input by role and the generic canonical
 * filename, never by a customer-specific filename or account. When unrelated JSON
 * files coexist, preflight and the model both select top-level meddpicc.json.
 */
export const PRIVATE_MEDDPICC_STEPS: MeddpiccStep[] = [
	{
		number: 1,
		title: "Prove the private working folder and fixture selection",
		prompt:
			"Report your current working directory. Confirm that this folder exposes one unambiguous MEDDPICC deal JSON: use its only top-level JSON file, or top-level meddpicc.json when unrelated JSON files coexist. Do not repeat customer values or modify anything.",
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
		title: "Review three priority gaps from the private deal",
		prompt:
			"Read the selected top-level MEDDPICC deal JSON (the only JSON file, or meddpicc.json when others coexist) and give a read-only health review. Within the eight MEDDPICC qualification elements, identify the three most urgent evidence-backed gaps and cite the deal evidence that makes each a gap. Do not repeat customer-specific filenames and do not modify anything.",
		readOnly: true,
	},
	{
		number: 5,
		title: "Create and verify the private Excel summary",
		prompt:
			"Read the selected top-level MEDDPICC deal JSON (the only JSON file, or meddpicc.json when others coexist) and the installed MEDDPICC engine status. Create or update a worksheet named MEDDPICC — Presentation. Call add_sheet with that name on every run; the tool is idempotent. Write a two-column executive summary to A1:B7 with these exact row labels: Metric/Value, Account, Score, Completion, Rating, Next section, Priority gaps. Populate the values from the deal and engine result, with exactly three semicolon-separated priority gaps. Read A1:B7 back and report the successful read-back. Reuse the sheet if it exists and do not modify any other sheet or any file.",
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

function privateSummaryValues(observation: ScenarioObservation): unknown[][] | null {
	const write = observation.hostToolCalls.find(call => call.toolName === "write_range");
	const values = write?.arguments.values;
	if (!Array.isArray(values) || values.length !== PRIVATE_SUMMARY_LABELS.length) return null;
	if (!values.every(row => Array.isArray(row) && row.length === 2)) return null;
	return values as unknown[][];
}

export interface PrivateStatusOracle {
	score: string;
	completion: string;
	rating: string;
}

/** Extract only the non-identifying engine metrics needed for a cross-turn oracle. */
export function extractPrivateStatusOracle(reply: string): PrivateStatusOracle | null {
	const score = reply.match(/\b(\d{1,2})\s*\/\s*32\b/);
	const completion = reply.match(/\b(\d{1,3}(?:\.\d+)?)%/);
	const rating = reply.match(/\b(red|yellow|green)\b/i);
	if (!score || !completion || !rating) return null;
	return {
		score: `${score[1]}/32`,
		completion: `${completion[1]}%`,
		rating: rating[1].toLocaleLowerCase(),
	};
}

/** Compare the private workbook's engine metrics with the earlier status turn. */
export function validatePrivateSummaryAgainstStatus(
	hostToolCalls: ScenarioObservation["hostToolCalls"],
	status: PrivateStatusOracle | null,
): ScenarioAssertion {
	const values = hostToolCalls.find(call => call.toolName === "write_range")?.arguments.values;
	if (!status || !Array.isArray(values)) {
		return assertion("Excel summary matches the engine-backed status turn", false);
	}
	const rows = new Map(
		values
			.filter((row): row is unknown[] => Array.isArray(row) && row.length === 2)
			.map(row => [String(row[0]), String(row[1]).trim()]),
	);
	const score = rows.get("Score")?.replaceAll(" ", "");
	const completion = rows.get("Completion")?.replaceAll(" ", "");
	const rating = rows.get("Rating")?.toLocaleLowerCase();
	return assertion(
		"Excel summary matches the engine-backed status turn",
		score === status.score && completion === status.completion && rating === status.rating,
	);
}

/** Content-independent oracle for an in-place private deal UAT. */
export function validatePrivateMeddpiccStep(stepNumber: number, observation: ScenarioObservation): ScenarioAssertion[] {
	const reply = observation.reply;
	switch (stepNumber) {
		case 1: {
			const topLevelJson = observation.filesBefore.filter(
				file => !file.path.includes("/") && file.path.toLowerCase().endsWith(".json"),
			);
			return [
				assertion("reply contains the exact private working directory", reply.includes(observation.workspace)),
				assertion(
					"workspace exposes one unambiguous MEDDPICC fixture",
					topLevelJson.length === 1 ||
						topLevelJson.filter(file => file.path.toLowerCase() === "meddpicc.json").length === 1,
				),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		}
		case 2:
			return [
				assertion("reply reports a valid schema", includes(reply, "schema") && includes(reply, "valid")),
				assertion("reply reports an engine score out of 32", /\b\d{1,2}\s*\/\s*32\b/.test(reply)),
				assertion("reply reports a completion percentage", /\b\d{1,3}(?:\.\d+)?%/.test(reply)),
				assertion("reply reports a traffic-light rating", /\b(?:red|yellow|green)\b/i.test(reply)),
				assertion("status command used the installed plugin engine", successfulTool(observation, ["bash", "read"])),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		case 3:
			return validateMeddpiccStep(3, observation);
		case 4: {
			const mentioned = CANONICAL_ELEMENTS.filter(element =>
				element === "Identify Pain"
					? includes(reply, "Identify Pain") || includes(reply, "Implicate the Pain")
					: includes(reply, element),
			);
			return [
				assertion("reply identifies at least three MEDDPICC qualification elements", mentioned.length >= 3),
				assertion("private fixture was read", successfulTool(observation, ["read", "bash"])),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("workbook snapshot is unchanged", unchangedWorkbook(observation)),
			];
		}
		case 5: {
			const calls = observation.hostToolCalls;
			const add = calls.find(call => call.toolName === "add_sheet");
			const write = calls.find(call => call.toolName === "write_range");
			const read = calls.find(call => call.toolName === "read_range");
			const values = privateSummaryValues(observation);
			const labelsMatch = values?.every((row, index) => row[0] === PRIVATE_SUMMARY_LABELS[index]) === true;
			const valuesPresent = values?.slice(1).every(row => String(row[1] ?? "").trim().length > 0) === true;
			const score = String(values?.[2]?.[1] ?? "").replaceAll(" ", "");
			const completion = String(values?.[3]?.[1] ?? "").replaceAll(" ", "");
			const rating = String(values?.[4]?.[1] ?? "");
			const priorityGaps = String(values?.[6]?.[1] ?? "")
				.split(";")
				.map(value => value.trim())
				.filter(Boolean);
			const summarySheets = Object.keys(observation.workbookAfter.sheets).filter(
				name => name === PRIVATE_SUMMARY_SHEET,
			);
			return [
				assertion(
					"add_sheet targeted the privacy-safe presentation summary",
					add?.arguments.name === PRIVATE_SUMMARY_SHEET,
				),
				assertion(
					"write_range targeted A1:B7 with the seven required rows",
					write?.arguments.address === PRIVATE_SUMMARY_RANGE && labelsMatch && valuesPresent,
				),
				assertion(
					"summary uses engine score, completion, and rating formats",
					/^\d{1,2}\/32$/.test(score) &&
						/^\d{1,3}(?:\.\d+)?%$/.test(completion) &&
						/^(red|yellow|green)$/i.test(rating),
				),
				assertion("summary contains exactly three priority gaps", priorityGaps.length === 3),
				assertion("read_range read A1:B7 back", read?.arguments.address === PRIVATE_SUMMARY_RANGE),
				assertion(
					"workbook contains exactly the values sent through the host tool",
					values !== null &&
						JSON.stringify(observation.workbookAfter.sheets[PRIVATE_SUMMARY_SHEET]?.["A1:B7"]) ===
							JSON.stringify(values),
				),
				assertion("the Start sheet is still active", observation.workbookAfter.activeSheet === "Start"),
				assertion("the Start sentinel sheet is unchanged", exactStartSheet(observation)),
				assertion("there is exactly one presentation summary sheet", summarySheets.length === 1),
				assertion("workspace snapshot is unchanged", unchangedFiles(observation)),
				assertion("assistant reports the read-back", includes(reply, "A1:B7")),
			];
		}
		default:
			return [assertion(`known private scenario step ${stepNumber}`, false)];
	}
}

/** Print the same prompts used by automation as a five-step presentation runbook. */
export function renderMeddpiccRunbook(): string {
	return MEDDPICC_STEPS.map(step => `${step.number}. ${step.title}\n\n${step.prompt}`).join("\n\n");
}
