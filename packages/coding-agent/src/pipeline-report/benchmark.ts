/**
 * pipeline-report/benchmark.ts
 *
 * Autoresearch benchmark harness for the pipeline report.
 * Generates a real pipeline report against the live Salesforce org
 * and scores it deterministically across 6 quality dimensions.
 *
 * Primary metric: report_quality_score (0–100, higher is better)
 *
 * OFF LIMITS to autoresearch modifications — this is the ground-truth evaluator.
 */

import { loadSalesforceContext } from "../internal-urls/salesforce-context";
import { loadProfile } from "../internal-urls/user-profile";
import { generatePipelineReport } from "./generator";
import { renderPipelineReport } from "./renderer";
import type { PipelineReportData } from "./types";

// ─── Fiscal quarter helpers ───────────────────────────────────────────
// F5 fiscal year starts November 1. Quarters:
//   Q1: Nov–Jan   Q2: Feb–Apr   Q3: May–Jul   Q4: Aug–Oct

function fiscalQuarterDates(): { start: string; end: string } {
	const now = new Date();
	const m = now.getMonth(); // 0-indexed
	const y = now.getFullYear();

	let start: Date;
	let end: Date;

	if (m >= 10) {
		// Nov–Dec → Q1 starts this year Nov, ends Jan next year
		start = new Date(y, 10, 1);
		end = new Date(y + 1, 1, 0);
	} else if (m === 0) {
		// Jan → still Q1 (Nov prev year – Jan this year)
		start = new Date(y - 1, 10, 1);
		end = new Date(y, 1, 0);
	} else if (m <= 3) {
		// Feb–Apr → Q2
		start = new Date(y, 1, 1);
		end = new Date(y, 4, 0);
	} else if (m <= 6) {
		// May–Jul → Q3
		start = new Date(y, 4, 1);
		end = new Date(y, 7, 0);
	} else {
		// Aug–Oct → Q4
		start = new Date(y, 7, 1);
		end = new Date(y, 10, 0);
	}

	const fmt = (d: Date) => d.toISOString().split("T")[0]!;
	return { start: fmt(start), end: fmt(end) };
}

// ─── Scoring helpers ──────────────────────────────────────────────────

interface DimScore {
	score: number;
	max: number;
	notes: string[];
}

function scoreSectionPresence(report: string): DimScore {
	const checks: Array<{ re: RegExp; label: string; pts: number }> = [
		{ re: /^# F5 Distributed Cloud Pipeline Report/m, label: "report header", pts: 2 },
		{ re: /\*\*Generated:\*\*/m, label: "generated timestamp", pts: 2 },
		{ re: /\*\*Quarter:\*\*/m, label: "quarter range", pts: 2 },
		{ re: /\*\*Summary:\*\*/m, label: "executive summary", pts: 3 },
		{ re: /Closed.*Booked/m, label: "booked section", pts: 3 },
		{ re: /Open Pipeline.*Net New/m, label: "net new section", pts: 3 },
		{ re: /Open Pipeline.*Renewals/m, label: "renewals section", pts: 3 },
		{ re: /Forecast Summary/m, label: "forecast summary", pts: 3 },
		{ re: /\*\*Line items:\*\*/m, label: "line item count", pts: 1 },
		{ re: /\*\*SKUs:\*\*/m, label: "SKU count", pts: 1 },
		{ re: /\*\*Model:\*\*/m, label: "value model description", pts: 1 },
	];
	let score = 0;
	let max = 0;
	const notes: string[] = [];
	for (const c of checks) {
		max += c.pts;
		if (c.re.test(report)) {
			score += c.pts;
		} else {
			notes.push(`Missing: ${c.label}`);
		}
	}
	return { score, max, notes };
}

function scoreDollarFormatting(report: string): DimScore {
	const notes: string[] = [];
	let score = 0;
	const max = 20;

	// Compact dollar amounts in summaries ($1.2M, $45K)
	if (/\$[\d,.]+[MK]\b/.test(report)) {
		score += 5;
	} else {
		notes.push("No compact dollar amounts ($XM/$XK) in summary lines");
	}

	// Precise dollar amounts in tables (1,234.56)
	if (/[\d,]+\.\d{2}/.test(report)) {
		score += 5;
	} else {
		notes.push("No precise dollar amounts (X,XXX.XX) in tables");
	}

	// Em-dash (—) for zero values instead of literal $0
	if (/\|\s*—\s*\|/.test(report)) {
		score += 3;
	}

	// No unformatted large numbers in table context
	const rawLarge = [...(report.matchAll(/(?<!\$)(?<!\d[,.])\b\d{5,}\b(?!\.\d{2})(?![MK%])/g) ?? [])].filter(m => {
		const ctx = report.slice(Math.max(0, m.index! - 20), m.index! + m[0].length + 20);
		return ctx.includes("|");
	});
	if (rawLarge.length === 0) {
		score += 4;
	} else {
		notes.push(`${rawLarge.length} unformatted large number(s) in table context`);
	}

	// No undefined/null/NaN in output
	const badValues = (report.match(/\bundefined\b|\bnull\b|\bNaN\b/g) ?? []).length;
	if (badValues === 0) {
		score += 3;
	} else {
		notes.push(`${badValues} occurrence(s) of undefined/null/NaN in output`);
	}

	return { score, max, notes };
}

function scoreDateFormatting(report: string): DimScore {
	const notes: string[] = [];
	let score = 0;
	const max = 10;

	// Generated timestamp: human-readable, not raw ISO
	const generatedMatch = report.match(/\*\*Generated:\*\*\s*(.+)/);
	if (generatedMatch) {
		const d = generatedMatch[1]!.trim();
		if (/^\d{4}-\d{2}-\d{2}T/.test(d)) {
			notes.push("Generated date uses raw ISO 8601 (should be locale string)");
		} else {
			score += 3;
		}
	}

	// Quarter line present and reasonably readable
	const quarterMatch = report.match(/\*\*Quarter:\*\*\s*(.+)/);
	if (quarterMatch) {
		score += quarterMatch[1]!.includes("-") ? 3 : 4;
	}

	// No raw ISO timestamps (2026-05-18T...) in the report body
	const rawTs = (report.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g) ?? []).length;
	if (rawTs === 0) {
		score += 3;
	} else {
		notes.push(`${rawTs} raw ISO timestamp(s) in report body`);
	}

	return { score, max, notes };
}

function scoreTableQuality(report: string): DimScore {
	const notes: string[] = [];
	let score = 0;
	const max = 15;

	const tables = report.match(/\|.+\|[\n\r]+\|[-:|]+\|/g) ?? [];
	if (tables.length === 0) {
		notes.push("No properly formatted markdown tables found");
		return { score: 0, max, notes };
	}
	score += 3;

	// All tables have separator rows (already implied by regex, this checks alignment chars)
	const hasRightAlign = /---:\|/.test(report);
	if (hasRightAlign) {
		score += 3;
	} else {
		notes.push("No right-aligned columns (amounts should be right-aligned with ---:|)");
	}

	// Tables have left-aligned label columns
	if (/:---\|/.test(report)) {
		score += 3;
	}

	// Territory grouping separators (bold em-dash rows)
	if (/\*\*.*—.*\*\*/.test(report)) {
		score += 3;
	}

	// Total rows (bold)
	if (/\|\s*\*\*Total\*\*\s*\|/.test(report)) {
		score += 3;
	} else {
		notes.push("No bold Total rows in tables");
	}

	return { score, max, notes };
}

function scoreDataDensity(data: PipelineReportData, report: string): DimScore {
	const notes: string[] = [];
	let score = 0;
	const max = 20;

	if (data.lineItemCount > 0) {
		score += 4;
	} else {
		notes.push("Zero line items processed");
	}

	const totalAccounts = data.netNew.accounts.length + data.booked.accounts.length + data.renewals.accounts.length;
	if (totalAccounts > 0) {
		score += 4;
	} else {
		notes.push("No accounts in any section");
	}

	const fc = data.forecast;
	const fcCount = [fc.commit, fc.bestCase, fc.pipeline].filter(v => v > 0).length;
	score += Math.min(5, fcCount * 2);
	if (fcCount === 0) {
		notes.push("No forecast category amounts populated");
	}

	if (data.skusFound.length > 0) {
		score += 3;
	} else {
		notes.push("No SKUs discovered");
	}

	// Anomaly detection running (even 0 anomalies means the engine ran)
	score += 2;
	if (data.anomalies.length > 0 && /Data Quality/.test(report)) {
		score += 2;
	}

	return { score, max, notes };
}

function scoreInformationValue(report: string): DimScore {
	const notes: string[] = [];
	let score = 0;
	const max = 10;

	// Quota total callouts (actionable for sales professionals)
	if (/Quota Total/i.test(report)) {
		score += 3;
	} else {
		notes.push("No quota total callouts");
	}

	// Forecast category breakdown visible (Commit, Best Case, Pipeline)
	if (/Commit/m.test(report) && /Best Case/m.test(report)) {
		score += 2;
	}

	// Platform vs Point product split (critical for overlay SE reporting)
	if (/Platform.*Distributed Cloud/m.test(report) || /Point.*Shape/m.test(report)) {
		score += 3;
	} else {
		notes.push("Platform/Point product split not visible");
	}

	// Territory context present
	if (/Territories:/m.test(report) || /Territory/m.test(report)) {
		score += 2;
	}

	return { score, max, notes };
}

// ─── Main ─────────────────────────────────────────────────────────────

const profile = await loadProfile();
const sfContext = await loadSalesforceContext();

if (!profile.identifiers?.salesforceId) {
	console.error("ERROR: No salesforceId in user profile. Run: xcsh://salesforce?refresh=true");
	process.exit(1);
}

if (!sfContext) {
	console.error("ERROR: No cached Salesforce context. Run: xcsh://salesforce?refresh=true");
	process.exit(1);
}

const userId = profile.identifiers.salesforceId;
const partnerId = profile.partner?.id;
const userIds = partnerId ? [userId, partnerId] : [userId];
const { start, end } = fiscalQuarterDates();

// Stale cutoff: 12 months ago to include non-stale pipeline beyond current quarter
const staleDate = new Date();
staleDate.setFullYear(staleDate.getFullYear() - 1);
const staleCutoff = staleDate.toISOString().split("T")[0]!;

const partnerName = profile.partner?.name;
const selfName = [profile.givenName, profile.familyName].filter(Boolean).join(" ").trim();
const teamMemberNames = partnerName && selfName ? [selfName, partnerName] : undefined;

const options = {
	userIds,
	orgAlias: sfContext.orgAlias,
	quarterStart: start,
	quarterEnd: end,
	staleCutoff,
	confirmedTerritories: profile.territories ?? sfContext.confirmedTerritories ?? sfContext.territories,
	teamMemberNames,
};

// ─── Generate and time ────────────────────────────────────────────────

const genStart = performance.now();
const data = await generatePipelineReport(options);
const generateMs = Math.round(performance.now() - genStart);

const renderStart = performance.now();
const report = renderPipelineReport(data, sfContext.instanceUrl);
const renderMs = Math.round(performance.now() - renderStart);

const totalMs = generateMs + renderMs;

// ─── Score ────────────────────────────────────────────────────────────

const sections = scoreSectionPresence(report);
const dollars = scoreDollarFormatting(report);
const dates = scoreDateFormatting(report);
const tables = scoreTableQuality(report);
const density = scoreDataDensity(data, report);
const infoVal = scoreInformationValue(report);

const rawScore = sections.score + dollars.score + dates.score + tables.score + density.score + infoVal.score;
const rawMax = sections.max + dollars.max + dates.max + tables.max + density.max + infoVal.max;
const qualityScore = Math.round((rawScore / rawMax) * 100);

const dataCompletenessPct = Math.round(
	([
		data.generated,
		data.quarter.start,
		data.quarter.end,
		data.lineItemCount > 0,
		data.skusFound.length > 0,
		data.netNew.accounts.length > 0 || data.booked.accounts.length > 0,
		data.forecast.commit > 0 || data.forecast.bestCase > 0 || data.forecast.pipeline > 0,
		data.territories.length > 0,
	].filter(Boolean).length /
		8) *
		100,
);

// Baseline generator makes 3 queries: net new + booked (parallel) + renewals (sequential)
const queryCount = 3;

const totalAccounts = data.netNew.accounts.length + data.booked.accounts.length + data.renewals.accounts.length;

// ─── Output METRIC lines ──────────────────────────────────────────────

console.log(`METRIC report_quality_score=${qualityScore}`);
console.log(`METRIC query_count=${queryCount}`);
console.log(`METRIC total_time_ms=${totalMs}`);
console.log(`METRIC generate_time_ms=${generateMs}`);
console.log(`METRIC render_time_ms=${renderMs}`);
console.log(`METRIC data_completeness_pct=${dataCompletenessPct}`);
console.log(`METRIC section_score=${sections.score}`);
console.log(`METRIC dollar_format_score=${dollars.score}`);
console.log(`METRIC date_format_score=${dates.score}`);
console.log(`METRIC table_alignment_score=${tables.score}`);
console.log(`METRIC data_density_score=${density.score}`);
console.log(`METRIC info_value_score=${infoVal.score}`);
console.log(`METRIC line_item_count=${data.lineItemCount}`);
console.log(`METRIC account_count=${totalAccounts}`);
console.log(`METRIC report_length=${report.length}`);
console.log(
	`ASI scoring_breakdown={"sections":${sections.score}/${sections.max},"dollars":${dollars.score}/${dollars.max},"dates":${dates.score}/${dates.max},"tables":${tables.score}/${tables.max},"density":${density.score}/${density.max},"infoValue":${infoVal.score}/${infoVal.max},"total":${rawScore}/${rawMax}}`,
);

const allNotes = [
	...sections.notes.map(n => `[sections] ${n}`),
	...dollars.notes.map(n => `[dollars] ${n}`),
	...dates.notes.map(n => `[dates] ${n}`),
	...tables.notes.map(n => `[tables] ${n}`),
	...density.notes.map(n => `[density] ${n}`),
	...infoVal.notes.map(n => `[info-value] ${n}`),
];

if (allNotes.length > 0) {
	console.log(`ASI deduction_notes=${JSON.stringify(allNotes)}`);
	console.log("");
	console.log("Deduction notes:");
	for (const note of allNotes) {
		console.log(`  - ${note}`);
	}
}
