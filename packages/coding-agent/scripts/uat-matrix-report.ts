/**
 * UAT matrix — shared cell type + report writer (markdown + JSON).
 *
 * The matrix is the deliverable: rows = (modality × resource × operation ×
 * phrase-id), grouped by modality then resource, with per-modality pass rates
 * (reusing the autoresearch METRIC vocabulary) and an ASI failures block.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type Modality = "console" | "json" | "hcl" | "i18n";
export type CellStatus = "PASS" | "FAIL" | "SKIP";

export interface Cell {
	modality: Modality;
	id: string;
	phrase: string;
	operation: string;
	resource: string;
	locale?: string;
	status: CellStatus;
	durationMs: number;
	detail: string;
	screenshots?: string[];
	httpCreate?: string;
	httpDelete?: string;
	/** For console cells: which path the agent actually used (router-determinism). */
	routedTo?: "console" | "api" | "file" | "unknown";
}

function pct(n: number, d: number): number {
	return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

function fmtDur(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function summarize(cells: Cell[]) {
	const byModality: Record<string, { total: number; pass: number; fail: number; skip: number }> = {};
	for (const c of cells) {
		if (!byModality[c.modality]) byModality[c.modality] = { total: 0, pass: 0, fail: 0, skip: 0 };
		const m = byModality[c.modality]!;
		m.total++;
		if (c.status === "PASS") m.pass++;
		else if (c.status === "FAIL") m.fail++;
		else m.skip++;
	}
	const total = cells.length;
	const pass = cells.filter(c => c.status === "PASS").length;
	const fail = cells.filter(c => c.status === "FAIL").length;
	const skip = cells.filter(c => c.status === "SKIP").length;
	return { total, pass, fail, skip, byModality };
}

/** Router-determinism for console cells: fraction that actually used the console. */
function routerStats(cells: Cell[]) {
	const console_ = cells.filter(c => c.modality === "console" && c.routedTo);
	const routed = console_.filter(c => c.routedTo === "console").length;
	return { measured: console_.length, routedToConsole: routed, rate: pct(routed, console_.length) };
}

export interface ReportContext {
	startedAt: string;
	finishedAt: string;
	tenant: string;
	consoleNamespace: string;
	apiUrl: string;
	modalities: Modality[];
	observable: boolean;
	delayMs: number;
}

export function writeReport(
	cells: Cell[],
	reportDir: string,
	ctx: ReportContext,
): { mdPath: string; jsonPath: string } {
	fs.mkdirSync(reportDir, { recursive: true });
	const summary = summarize(cells);
	const router = routerStats(cells);

	// --- JSON ---
	const jsonPath = path.join(reportDir, "report.json");
	fs.writeFileSync(jsonPath, JSON.stringify({ ...ctx, summary, router, cells }, null, 2));

	// --- Markdown ---
	const L: string[] = [];
	L.push(`# F5 XC Console Agent — UAT Matrix Report`, "");
	L.push(`- Started: ${ctx.startedAt}`);
	L.push(`- Finished: ${ctx.finishedAt}`);
	L.push(`- Tenant: \`${ctx.tenant}\`  |  Console namespace: \`${ctx.consoleNamespace}\`  |  API: \`${ctx.apiUrl}\``);
	L.push(
		`- Modalities: ${ctx.modalities.join(", ")}  |  Observable: ${ctx.observable}  |  Step delay: ${ctx.delayMs}ms`,
	);
	L.push("");
	L.push(`## Summary`, "");
	L.push(`✅ PASS ${summary.pass} · ❌ FAIL ${summary.fail} · ⏭ SKIP ${summary.skip} · total ${summary.total}`, "");
	L.push(`| Modality | Total | Pass | Fail | Skip | Pass rate |`);
	L.push(`|---|---:|---:|---:|---:|---:|`);
	for (const [m, s] of Object.entries(summary.byModality)) {
		L.push(`| ${m} | ${s.total} | ${s.pass} | ${s.fail} | ${s.skip} | ${pct(s.pass, s.total - s.skip)}% |`);
	}
	L.push("");

	// METRIC lines (autoresearch vocabulary, for comparability)
	L.push("```");
	for (const [m, s] of Object.entries(summary.byModality)) {
		L.push(`METRIC ${m}_pass_rate=${pct(s.pass, s.total - s.skip)}`);
	}
	if (router.measured > 0) L.push(`METRIC console_router_accuracy=${router.rate}`);
	L.push("```", "");

	// --- Matrix, grouped by modality then resource ---
	L.push(`## Matrix`, "");
	const mods = [...new Set(cells.map(c => c.modality))];
	for (const mod of mods) {
		L.push(`### ${mod}`, "");
		L.push(`| Phrase id | Resource | Op | Status | Duration | HTTP (C/D) | Routed | Detail |`);
		L.push(`|---|---|---|---|---:|---|---|---|`);
		const modCells = cells.filter(c => c.modality === mod);
		for (const c of modCells.sort((a, b) => (a.resource + a.id).localeCompare(b.resource + b.id))) {
			const icon = c.status === "PASS" ? "✅" : c.status === "FAIL" ? "❌" : "⏭";
			const http = `${c.httpCreate ?? "-"}/${c.httpDelete ?? "-"}`;
			const detail = (c.detail || "").replace(/\|/g, "\\|").slice(0, 80);
			const loc = c.locale ? ` (${c.locale})` : "";
			L.push(
				`| ${c.id}${loc} | ${c.resource} | ${c.operation} | ${icon} ${c.status} | ${fmtDur(c.durationMs)} | ${http} | ${c.routedTo ?? "-"} | ${detail} |`,
			);
		}
		L.push("");
	}

	// --- Router determinism ---
	if (router.measured > 0) {
		L.push(`## Router determinism (console phrases)`, "");
		L.push(`${router.routedToConsole}/${router.measured} console phrases drove the console UI (${router.rate}%).`);
		const leaks = cells.filter(c => c.modality === "console" && c.routedTo === "api");
		if (leaks.length) {
			L.push("", "Phrases that leaked to the API instead of the console:");
			for (const c of leaks) L.push(`- \`${c.id}\`: ${c.phrase}`);
		}
		L.push("");
	}

	// --- ASI failures (autoresearch-style) ---
	const failures = cells.filter(c => c.status === "FAIL");
	L.push(`## Failures`, "");
	if (failures.length === 0) {
		L.push("None. 🎉", "");
	} else {
		for (const c of failures) {
			L.push(`- **${c.id}** (${c.modality}/${c.operation}/${c.resource}): ${c.detail}`);
			if (c.screenshots?.length) L.push(`  - screenshots: ${c.screenshots.map(s => `\`${s}\``).join(", ")}`);
		}
		L.push("");
		const asi = failures.map(c => ({
			id: c.id,
			modality: c.modality,
			operation: c.operation,
			resource: c.resource,
			http_create: c.httpCreate,
			http_delete: c.httpDelete,
			routed_to: c.routedTo,
			detail: c.detail.slice(0, 160),
		}));
		L.push("```");
		L.push(`ASI failures=${JSON.stringify(asi)}`);
		L.push("```", "");
	}

	const mdPath = path.join(reportDir, "report.md");
	fs.writeFileSync(mdPath, L.join("\n"));
	return { mdPath, jsonPath };
}
