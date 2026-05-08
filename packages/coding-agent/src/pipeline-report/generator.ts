import { logger } from "@f5xc-salesdemos/pi-utils";
import { $ } from "bun";
import type {
	AccountRow,
	DataAnomaly,
	ForecastSummary,
	LineItemRecord,
	PipelineReportData,
	PipelineReportOptions,
	SectionData,
	SectionTotals,
	SkuClassification,
} from "./types";
import { DEFAULT_SKU_CLASSIFICATION, DEFAULT_SKU_PREFIXES } from "./types";

// ---------------------------------------------------------------------------
// SOQL helper
// ---------------------------------------------------------------------------

async function runSfQuery(soql: string, orgAlias?: string): Promise<Record<string, unknown>[]> {
	try {
		const cmd = orgAlias
			? $`sf data query --query ${soql} --json --target-org ${orgAlias}`
			: $`sf data query --query ${soql} --json`;
		const result = await cmd.quiet().nothrow();
		if (result.exitCode !== 0) return [];
		const parsed = JSON.parse(result.stdout.toString()) as {
			result?: { records?: Record<string, unknown>[] };
		};
		return parsed.result?.records ?? [];
	} catch (err) {
		logger.debug("Pipeline SOQL query failed", { error: err });
		return [];
	}
}

// ---------------------------------------------------------------------------
// SKU classification
// ---------------------------------------------------------------------------

function classifySku(skuName: string, rules: SkuClassification): "platform" | "shape" | "other" {
	const upper = skuName.toUpperCase();
	for (const prefix of rules.shape) {
		if (upper.startsWith(prefix.toUpperCase())) return "shape";
	}
	for (const prefix of rules.platform) {
		if (upper.startsWith(prefix.toUpperCase())) return "platform";
	}
	return "other";
}

// ---------------------------------------------------------------------------
// Record parsing
// ---------------------------------------------------------------------------

function parseLineItem(record: Record<string, unknown>, rules: SkuClassification): LineItemRecord {
	const opp = (record.Opportunity ?? {}) as Record<string, unknown>;
	const acct = (opp.Account ?? {}) as Record<string, unknown>;
	const product = (record.Product2 ?? {}) as Record<string, unknown>;
	const skuName = (product.Name ?? "") as string;

	return {
		opportunityId: (opp.Id ?? "") as string,
		accountName: (acct.Name ?? "") as string,
		territory: (opp.Territory_Credited_District_del__c ?? "") as string,
		forecast: (opp.ForecastCategoryName ?? "") as string,
		skuName,
		fyb: (record.FYB_Total_Price__c as number) ?? 0,
		category: classifySku(skuName, rules),
	};
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

function buildSkuFilter(prefixes: string[]): string {
	return prefixes.map(p => `Product2.Name LIKE '${p}%'`).join(" OR ");
}

function buildUserFilter(userIds: string[]): string {
	return userIds.length === 1 ? `UserId = '${userIds[0]}'` : `UserId IN (${userIds.map(id => `'${id}'`).join(",")})`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function emptyTotals(): SectionTotals {
	return { platform: 0, shape: 0, other: 0 };
}

function aggregateLineItems(items: LineItemRecord[]): SectionData {
	const accountMap = new Map<string, { totals: SectionTotals; territory: string }>();

	for (const item of items) {
		if (item.fyb <= 0) continue;
		const existing = accountMap.get(item.accountName) ?? {
			totals: emptyTotals(),
			territory: item.territory,
		};
		existing.totals[item.category] += item.fyb;
		if (!accountMap.has(item.accountName)) existing.territory = item.territory;
		accountMap.set(item.accountName, existing);
	}

	// Only include accounts with quota-eligible value (platform or shape > 0)
	const filtered = [...accountMap]
		.filter(([, v]) => v.totals.platform + v.totals.shape > 0)
		.map(
			([name, v]): AccountRow => ({
				name,
				territory: v.territory,
				...v.totals,
			}),
		)
		.sort((a, b) => b.platform + b.shape - (a.platform + a.shape));

	const totals = emptyTotals();
	for (const row of filtered) {
		totals.platform += row.platform;
		totals.shape += row.shape;
		totals.other += row.other;
	}

	return {
		accounts: filtered,
		totals,
		quotaTotal: totals.platform + totals.shape,
	};
}

function buildForecast(items: LineItemRecord[]): ForecastSummary {
	const buckets: Record<string, number> = { Commit: 0, "Best Case": 0, Pipeline: 0 };
	for (const item of items) {
		if (item.category === "other" || item.fyb <= 0) continue;
		if (item.forecast in buckets) buckets[item.forecast] += item.fyb;
	}
	return { commit: buckets.Commit, bestCase: buckets["Best Case"], pipeline: buckets.Pipeline };
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function detectAnomalies(
	netNew: LineItemRecord[],
	booked: LineItemRecord[],
	classification: SkuClassification,
): DataAnomaly[] {
	const anomalies: DataAnomaly[] = [];
	const all = [...netNew, ...booked];

	// 1. SKUs classified as 'other' — may be missing from classification rules
	const otherSkus = new Set<string>();
	for (const item of all) {
		if (item.category === "other") otherSkus.add(item.skuName);
	}
	if (otherSkus.size > 0) {
		anomalies.push({
			severity: "info",
			category: "sku-classification",
			message: `${otherSkus.size} SKU(s) are not classified as Platform or Shape/DI`,
			details: [...otherSkus].sort().join(", "),
		});
	}

	// 2. Opportunities with no territory assigned
	const noTerritory = new Set<string>();
	for (const item of netNew) {
		if (!item.territory) noTerritory.add(item.accountName);
	}
	if (noTerritory.size > 0) {
		anomalies.push({
			severity: "warning",
			category: "missing-territory",
			message: `${noTerritory.size} account(s) have open pipeline with no territory assigned`,
			details: [...noTerritory].sort().join(", "),
		});
	}

	// 3. Accounts with all pipeline in 'Pipeline' forecast only (no Commit or Best Case)
	// This may indicate deals that haven't been qualified or forecasted properly
	const acctForecasts = new Map<string, Set<string>>();
	for (const item of netNew) {
		if (!acctForecasts.has(item.accountName)) acctForecasts.set(item.accountName, new Set());
		acctForecasts.get(item.accountName)!.add(item.forecast);
	}
	const pipelineOnly = [...acctForecasts]
		.filter(([, fcs]) => fcs.size === 1 && fcs.has("Pipeline"))
		.map(([name]) => name);
	if (pipelineOnly.length > 3) {
		anomalies.push({
			severity: "info",
			category: "forecast-hygiene",
			message: `${pipelineOnly.length} account(s) have all open pipeline in 'Pipeline' stage only (no Commit or Best Case)`,
			details: pipelineOnly.sort().join(", "),
		});
	}

	// 4. Detect $0 FYB line items that were filtered out — indicates formula problems
	// We can't see them in this dataset, but note the classification in the report
	const classifiedSkus = [...classification.platform, ...classification.shape];
	if (classifiedSkus.length < 3) {
		anomalies.push({
			severity: "warning",
			category: "sku-config",
			message: "Very few SKU classification rules defined — may miss products",
			details: "Run xcsh://salesforce?refresh=true to rediscover from pipeline data",
		});
	}

	return anomalies;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generatePipelineReport(options: PipelineReportOptions): Promise<PipelineReportData> {
	const {
		userIds,
		orgAlias,
		quarterStart,
		quarterEnd,
		skuPrefixes = DEFAULT_SKU_PREFIXES,
		skuClassification = DEFAULT_SKU_CLASSIFICATION,
	} = options;
	// staleCutoff: if set, in-play shows all non-stale pipeline regardless of close quarter
	// if not set, in-play is scoped to current quarter close dates
	const staleCutoff = options.staleCutoff;

	const userFilter = buildUserFilter(userIds);
	const ownerFilter =
		userIds.length === 1 ? `OwnerId = '${userIds[0]}'` : `OwnerId IN (${userIds.map(id => `'${id}'`).join(",")})`;
	const skuFilter = buildSkuFilter(skuPrefixes);

	const fields = [
		"Product2.Name",
		"FYB_Total_Price__c",
		"Opportunity.Id",
		"Opportunity.Account.Name",
		"Opportunity.Territory_Credited_District_del__c",
		"Opportunity.ForecastCategoryName",
	].join(", ");
	const commonFilters = `Subscription_Renewal__c = false AND Opportunity.ForecastCategoryName != 'Omitted' AND FYB_Total_Price__c > 0 AND (${skuFilter})`;
	const quarterDateFilter = `Opportunity.CloseDate >= ${quarterStart} AND Opportunity.CloseDate <= ${quarterEnd}`;
	const inPlayDateFilter = staleCutoff ? `Opportunity.CloseDate >= ${staleCutoff}` : quarterDateFilter;

	const teamScope = `(OpportunityId IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE ${userFilter}) OR ${ownerFilter})`;

	// In-play: uses staleCutoff if set, otherwise quarter dates
	// Booked: always quarter dates
	const [netNewRecords, bookedRecords] = await Promise.all([
		runSfQuery(
			`SELECT ${fields} FROM OpportunityLineItem WHERE ${teamScope} AND Opportunity.IsClosed = false AND ${inPlayDateFilter} AND ${commonFilters}`,
			orgAlias,
		),
		runSfQuery(
			`SELECT ${fields} FROM OpportunityLineItem WHERE ${teamScope} AND Opportunity.IsWon = true AND ${quarterDateFilter} AND ${commonFilters}`,
			orgAlias,
		),
	]);

	// Parse line items
	const netNewItems = netNewRecords.map(r => parseLineItem(r, skuClassification));
	const bookedItems = bookedRecords.map(r => parseLineItem(r, skuClassification));

	// --- Renewals: opportunity-level True_ACV (FYB returns $0 for renewals) ---
	const renewalFields = [
		"Id",
		"Account.Name",
		"True_ACV__c",
		"Upsell_ACV__c",
		"Amount",
		"Product_Segmentation__c",
		"Use_Case_Category__c",
		"ForecastCategoryName",
		"Territory_Credited_District_del__c",
	].join(", ");

	const renewalDateFilter = staleCutoff
		? `CloseDate >= ${staleCutoff}`
		: `CloseDate >= ${quarterStart} AND CloseDate <= ${quarterEnd}`;
	const renewalWhere = `(Id IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE ${userFilter}) OR ${ownerFilter}) AND IsClosed = false AND Renewal__c = true AND ${renewalDateFilter} AND ForecastCategoryName != 'Omitted' AND (True_ACV__c > 1 OR Upsell_ACV__c > 1 OR Amount > 1)`;

	const renewalRecords = await runSfQuery(
		`SELECT ${renewalFields} FROM Opportunity WHERE ${renewalWhere} ORDER BY True_ACV__c DESC NULLS LAST`,
		orgAlias,
	);

	// Parse and classify renewal opps, dedup by Id
	const seenIds = new Set<string>();
	const renewalItems: LineItemRecord[] = [];
	for (const r of renewalRecords) {
		const id = (r.Id ?? "") as string;
		if (seenIds.has(id)) continue;
		seenIds.add(id);
		const acct = ((r.Account as Record<string, unknown> | undefined)?.Name ?? "") as string;
		const terr = (r.Territory_Credited_District_del__c ?? "") as string;
		const fc = (r.ForecastCategoryName ?? "") as string;
		const upsell = (r.Upsell_ACV__c as number) ?? 0;
		const acv = (r.True_ACV__c as number) ?? 0;
		const amt = (r.Amount as number) ?? 0;
		const val = upsell > 0 ? upsell : acv > 0 ? acv : amt;
		if (val <= 0) continue;

		// Classify by Product_Segmentation__c
		const seg = ((r.Product_Segmentation__c as string) ?? "").toLowerCase();
		const uc = ((r.Use_Case_Category__c as string) ?? "").toLowerCase();
		let category: "platform" | "shape" | "other" = "other";
		if (seg.includes("xc") || seg.includes("cspp") || uc.includes("distributed cloud")) {
			category = "platform";
		} else if (seg.includes("point")) {
			category = seg.includes("xc") ? "platform" : "shape";
		} else if (seg.includes("ela")) {
			// ELA renewals: classify as platform if use case is XC-related
			category = uc.includes("distributed cloud") ? "platform" : "other";
		}

		renewalItems.push({
			opportunityId: id,
			accountName: acct,
			territory: terr,
			forecast: fc,
			skuName: (r.Product_Segmentation__c ?? "") as string,
			fyb: val,
			category,
		});
	}

	// Collect distinct SKUs
	const allSkus = new Set<string>();
	for (const item of [...netNewItems, ...bookedItems]) {
		if (item.skuName) allSkus.add(item.skuName);
	}
	// Detect anomalies
	const anomalies = detectAnomalies(netNewItems, bookedItems, skuClassification);

	return {
		generated: new Date().toISOString(),
		quarter: { start: quarterStart, end: quarterEnd },
		territories: options.confirmedTerritories ?? [],
		teamMembers: options.teamMemberNames ?? [],
		netNew: aggregateLineItems(netNewItems),
		booked: aggregateLineItems(bookedItems),
		renewals: aggregateLineItems(renewalItems),
		forecast: buildForecast(netNewItems),
		lineItemCount: netNewItems.length + bookedItems.length + renewalItems.length,
		skusFound: [...allSkus].sort(),
		anomalies,
	};
}
