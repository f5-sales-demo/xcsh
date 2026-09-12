import { join, resolve } from "node:path";
import { incompleteEvidence, type TuiLedgerEntry } from "../test/helpers/tui-surface-inventory";

const FINAL_FINGERPRINT = "ca9c5c03475c256d54a3d5b0edd0e06b78802dc7b56dd777652299df0fb2a98b";
const FINAL_VERDICT = "pass-actual-terminal";
const EXPECTED_ROWS = 437;
const finalDirectories = [
	"terminal-memory-fast-final-v1",
	"terminal-force-final-v1",
	"terminal-route-mode-final-v1",
	"terminal-plan-mode-final-v1",
	"terminal-publication-launcher-final-v1",
	"terminal-copy-clipboard-final-v1",
	"terminal-memory-actions-final-v1",
	"terminal-manual-compaction-final-v1",
	"terminal-plugin-metadata-refresh-final-v1",
	"terminal-background-transfer-final-v1",
	"terminal-reviewed-exit-final-v1",
	"terminal-browser-chrome-final-v1",
	"terminal-reports-final-v1",
	"terminal-foundation-login-model-final-v1",
	"terminal-plugin-lifecycle-final-v1",
	"terminal-settings-inventories-final-v1",
	"terminal-sessions-final-v1",
	"terminal-resources-artifacts-final-v1",
	"terminal-connections-final-v1",
] as const;
const legacyToFinal = new Map([
	["terminal-memory-fast-v2", "terminal-memory-fast-final-v1"],
	["terminal-force-matrix-v2", "terminal-force-final-v1"],
	["terminal-route-mode-v3", "terminal-route-mode-final-v1"],
	["terminal-plan-mode-v3", "terminal-plan-mode-final-v1"],
	["terminal-publication-launcher-v1", "terminal-publication-launcher-final-v1"],
	["terminal-memory-actions-v1", "terminal-memory-actions-final-v1"],
	["terminal-manual-compaction-v1", "terminal-manual-compaction-final-v1"],
	["terminal-plugin-metadata-refresh-v1", "terminal-plugin-metadata-refresh-final-v1"],
	["terminal-background-transfer-v1", "terminal-background-transfer-final-v1"],
	["terminal-reviewed-exit-v1", "terminal-reviewed-exit-final-v1"],
	["terminal-browser-chrome-v1", "terminal-browser-chrome-final-v1"],
	["terminal-reports-v2", "terminal-reports-final-v1"],
	["terminal-foundation-login-model-v1", "terminal-foundation-login-model-final-v1"],
	["terminal-plugin-lifecycle-v2", "terminal-plugin-lifecycle-final-v1"],
	["terminal-settings-inventories-v2", "terminal-settings-inventories-final-v1"],
	["terminal-sessions-v1", "terminal-sessions-final-v1"],
	["terminal-resources-artifacts-v1", "terminal-resources-artifacts-final-v1"],
	["terminal-connections-v1", "terminal-connections-final-v1"],
]);

const root = resolve(import.meta.dir, "../../..");
const evidenceRoot = join(root, "packages/coding-agent/test/evidence");
const ledgerPath = join(evidenceRoot, "tui-implementation-ledger.json");
const reviewReceipt = (await Bun.file(join(evidenceRoot, "final-matrix-visual-review.json")).json()) as {
	fingerprint?: string;
	overallVerdict?: string;
	matrices?: Array<{ directory?: string; verdict?: string }>;
};
if (
	reviewReceipt.fingerprint !== FINAL_FINGERPRINT ||
	reviewReceipt.overallVerdict !== FINAL_VERDICT ||
	reviewReceipt.matrices?.length !== finalDirectories.length ||
	finalDirectories.some(
		directory =>
			!reviewReceipt.matrices?.some(item => item.directory === directory && item.verdict === FINAL_VERDICT),
	)
)
	throw new Error("The final matrix visual review receipt is missing, stale, or incomplete");

for (const directory of finalDirectories) {
	const matrix = (await Bun.file(join(evidenceRoot, directory, "matrix.json")).json()) as {
		complete?: boolean;
		runs?: Array<{ passed?: boolean; visualVerdict?: string }>;
	};
	const inventory = (await Bun.file(join(evidenceRoot, directory, "visual-inventory.json")).json()) as {
		fingerprint?: string;
		visualVerdict?: string;
	};
	const review = await Bun.file(join(evidenceRoot, directory, "visual-review.md")).text();
	if (
		matrix.complete !== true ||
		matrix.runs?.length !== 16 ||
		matrix.runs.some(run => !run.passed || run.visualVerdict !== FINAL_VERDICT) ||
		inventory.fingerprint !== FINAL_FINGERPRINT ||
		inventory.visualVerdict !== FINAL_VERDICT ||
		!review.includes(FINAL_FINGERPRINT) ||
		!review.includes(FINAL_VERDICT)
	)
		throw new Error(`Final evidence is incomplete: ${directory}`);
}

const ledger = (await Bun.file(ledgerPath).json()) as { schemaVersion: 1; entries: TuiLedgerEntry[] };
if (ledger.schemaVersion !== 1 || ledger.entries.length !== EXPECTED_ROWS)
	throw new Error(`Expected schema 1 with ${EXPECTED_ROWS} rows, found ${ledger.entries.length}`);
if (new Set(ledger.entries.map(entry => entry.surface.id)).size !== EXPECTED_ROWS)
	throw new Error("Ledger contains duplicate surface ids");

function updateEvidenceReference(value: string): string {
	let updated = value;
	for (const [legacy, current] of legacyToFinal) updated = updated.replaceAll(legacy, current);
	updated = updated.replaceAll(/terminal-copy-clipboard(?!-final-v1)/g, "terminal-copy-clipboard-final-v1");
	updated = updated
		.replaceAll("terminal-plan-mode-final-v1 · 224", "terminal-plan-mode-final-v1 · 236")
		.replaceAll("terminal-settings-inventories-final-v1 · 288", "terminal-settings-inventories-final-v1 · 276")
		.replaceAll("terminal-settings-inventories-final-v1 (288", "terminal-settings-inventories-final-v1 (276")
		.replaceAll("terminal-reports-final-v1 (538", "terminal-reports-final-v1 (536")
		.replaceAll("all 538 PNGs", "all 536 PNGs")
		.replaceAll("36 contact sheets", "34 contact sheets");
	return updated;
}

const completionNote =
	"Final current-source actual-terminal evidence is fingerprint-pinned at " +
	FINAL_FINGERPRINT +
	"; all applicable 16-variant matrices and direct visual reviews pass.";
for (const entry of ledger.entries) {
	entry.adapter = entry.adapter ? updateEvidenceReference(entry.adapter) : null;
	entry.reviewPolicy = entry.reviewPolicy ? updateEvidenceReference(entry.reviewPolicy) : null;
	for (const field of ["states", "tests", "persistence", "captures", "visualVerdicts"] as const)
		entry[field] = entry[field].map(updateEvidenceReference);
	entry.notes = entry.notes
		.filter(
			note =>
				note !== "Complete-candidate convergence and final current-source gates remain pending." &&
				!note.startsWith("Final current-source actual-terminal evidence is fingerprint-pinned at "),
		)
		.map(updateEvidenceReference);
	if (!entry.notes.includes(completionNote)) entry.notes.push(completionNote);
	entry.status = "verified";
	const missing = incompleteEvidence(entry);
	if (missing.length) throw new Error(`Cannot verify ${entry.surface.id}; missing ${missing.join(", ")}`);
}

const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
for (const legacy of legacyToFinal.keys())
	if (serialized.includes(legacy)) throw new Error(`Ledger still references historical evidence: ${legacy}`);
if (/terminal-copy-clipboard(?!-final-v1)/.test(serialized))
	throw new Error("Ledger still references historical clipboard evidence");

await Bun.write(ledgerPath, serialized);
console.log(
	JSON.stringify({
		total: ledger.entries.length,
		verified: ledger.entries.filter(entry => entry.status === "verified").length,
		required: ledger.entries.filter(entry => entry.status === "required").length,
		inProgress: ledger.entries.filter(entry => entry.status === "in-progress").length,
		fingerprint: FINAL_FINGERPRINT,
	}),
);
