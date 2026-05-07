import type { AccountRow, DataAnomaly, PipelineReportData, SectionData } from "./types";

function fmtCurrency(val: number): string {
	if (val === 0) return "\u2014";
	return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(val: number): string {
	if (val === 0) return "\u2014";
	if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
	if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
	return `$${val.toFixed(0)}`;
}

interface ColumnDef {
	header: string;
	key: keyof AccountRow;
}

function renderSection(title: string, section: SectionData, columns: ColumnDef[]): string {
	if (section.accounts.length === 0) return "";

	const lines: string[] = [];
	lines.push(`## ${title}`);
	lines.push("");

	const hdrs = ["Account", ...columns.map(c => c.header)];
	lines.push(`| ${hdrs.join(" | ")} |`);
	lines.push(`|${[":---", ...columns.map(() => "---:")].join("|")}|`);

	// Group by territory
	const byTerritory = new Map<string, AccountRow[]>();
	for (const row of section.accounts) {
		const t = row.territory || "Unassigned";
		const arr = byTerritory.get(t) ?? [];
		arr.push(row);
		byTerritory.set(t, arr);
	}

	for (const [territory, rows] of byTerritory) {
		if (byTerritory.size > 1) {
			lines.push(`| **\u2014 ${territory} \u2014** | ${columns.map(() => "").join(" | ")} |`);
		}
		for (const row of rows) {
			const vals = columns.map(c => fmtCurrency(row[c.key] as number));
			lines.push(`| ${row.name} | ${vals.join(" | ")} |`);
		}
	}

	const totalVals = columns.map(c => {
		const v = (section.totals as unknown as Record<string, number>)[c.key] ?? 0;
		return `**${fmtCurrency(v)}**`;
	});
	lines.push(`| **Total** | ${totalVals.join(" | ")} |`);
	lines.push("");
	lines.push(`**Quota Total (Platform + Shape/DI):** ${fmtCompact(section.quotaTotal)}`);
	lines.push("");

	return lines.join("\n");
}

function renderAnomalies(anomalies: DataAnomaly[]): string {
	if (anomalies.length === 0) return "";

	const lines: string[] = [];
	lines.push("## Data Quality");
	lines.push("");

	for (const a of anomalies) {
		const icon = a.severity === "error" ? "[ERROR]" : a.severity === "warning" ? "[WARN]" : "[INFO]";
		lines.push(`- **${icon} ${a.category}:** ${a.message}`);
		if (a.details) lines.push(`  - ${a.details}`);
	}
	lines.push("");

	return lines.join("\n");
}

export function renderPipelineReport(data: PipelineReportData, _instanceUrl: string): string {
	const lines: string[] = [];

	lines.push("# F5 Distributed Cloud Pipeline Report");
	lines.push("");
	lines.push(`**Generated:** ${new Date(data.generated).toLocaleString()}`);
	lines.push(`**Quarter:** ${data.quarter.start} \u2014 ${data.quarter.end}`);
	if (data.territories.length > 0) {
		lines.push(`**Territories:** ${data.territories.join(" | ")}`);
	}
	if (data.teamMembers.length > 0) {
		lines.push(`**Team:** ${data.teamMembers.join(" + ")}`);
	}
	lines.push(`**Model:** FYB (Net New) + True ACV (Renewals) | In-quarter scope`);
	lines.push(`**Line items:** ${data.lineItemCount} | **SKUs:** ${data.skusFound.length}`);
	lines.push("");

	// Helper: render one product group (Platform or Point) as its own sub-table
	function renderProductGroup(
		sectionTitle: string,
		accounts: AccountRow[],
		valueKey: "platform" | "shape",
		label: string,
	): string {
		const rows = accounts.filter(r => (r[valueKey] as number) > 0);
		if (rows.length === 0) return "";
		const total = rows.reduce((s, r) => s + (r[valueKey] as number), 0);

		const lines: string[] = [];
		lines.push(`### ${sectionTitle} \u2014 ${label}`);
		lines.push("");
		lines.push("| Account | Amount |");
		lines.push("|:---|---:|");

		// Group by territory
		const byTerritory = new Map<string, AccountRow[]>();
		for (const row of rows) {
			const t = row.territory || "Unassigned";
			const arr = byTerritory.get(t) ?? [];
			arr.push(row);
			byTerritory.set(t, arr);
		}
		for (const [territory, territoryRows] of byTerritory) {
			if (byTerritory.size > 1) {
				lines.push(`| **\u2014 ${territory} \u2014** | |`);
			}
			for (const row of territoryRows) {
				lines.push(`| ${row.name} | ${fmtCurrency(row[valueKey] as number)} |`);
			}
		}
		lines.push(`| **Total** | **${fmtCurrency(total)}** |`);
		lines.push("");
		return lines.join("\n");
	}

	function renderBiSection(title: string, section: SectionData): string {
		if (section.accounts.length === 0) return "";
		const platform = renderProductGroup(title, section.accounts, "platform", "Platform (Distributed Cloud)");
		const point = renderProductGroup(title, section.accounts, "shape", "Point (Shape + DI)");
		if (!platform && !point) return "";
		const parts: string[] = [];
		if (platform) parts.push(platform);
		if (point) parts.push(point);
		// Combined quota total for this section
		const quotaLabel = `**${title} Quota Total (Platform + Point):** ${fmtCompact(section.quotaTotal)}`;
		parts.push(quotaLabel, "");
		return parts.join("\n");
	}

	const booked = renderBiSection("Closed \u2014 Booked This Quarter", data.booked);
	if (booked) lines.push(booked);

	const netNew = renderBiSection("Open Pipeline \u2014 Net New", data.netNew);
	if (netNew) lines.push(netNew);

	const renewals = renderBiSection("Open Pipeline \u2014 Renewals", data.renewals);
	if (renewals) lines.push(renewals);

	// Forecast
	const fc = data.forecast;
	const fcTotal = fc.commit + fc.bestCase + fc.pipeline;
	lines.push("## Forecast Summary \u2014 Platform + Point");
	lines.push("");
	lines.push("| Category | Amount |");
	lines.push("|:---|---:|");
	lines.push(`| Commit | ${fmtCurrency(fc.commit)} |`);
	lines.push(`| Best Case | ${fmtCurrency(fc.bestCase)} |`);
	lines.push(`| Pipeline | ${fmtCurrency(fc.pipeline)} |`);
	lines.push(`| **Total** | **${fmtCurrency(fcTotal)}** |`);
	lines.push("");

	// Anomalies
	const anomalySection = renderAnomalies(data.anomalies);
	if (anomalySection) lines.push(anomalySection);

	// SKUs discovered
	if (data.skusFound.length > 0) {
		lines.push("## SKUs Discovered");
		lines.push("");
		lines.push(data.skusFound.map(s => `\`${s}\``).join(", "));
		lines.push("");
	}

	return lines.join("\n");
}
