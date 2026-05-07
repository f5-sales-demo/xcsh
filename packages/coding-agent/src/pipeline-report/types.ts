/** SKU prefix groups used to classify line items into quota categories. */
export interface SkuClassification {
	/** SKU name prefixes that count as Platform (XC/Distributed Cloud) */
	platform: string[];
	/** SKU name prefixes that count as Shape/DI (Point products) */
	shape: string[];
}

/** Default classification — discoverable from actual pipeline data. */
export const DEFAULT_SKU_CLASSIFICATION: SkuClassification = {
	platform: ["F5-V-O", "F5-XC", "F5-FAS-WAF", "F5-FAS-API", "F5-UTIL", "F5-CST"],
	shape: ["F5-SHP", "F5-FAS-BOT", "F5-FAS-DOS"],
};

/** All SKU prefixes that define the XC/Shape overlay product scope. */
export const DEFAULT_SKU_PREFIXES = ["F5-V-O", "F5-XC", "F5-FAS", "F5-SHP", "F5-UTIL", "F5-CST"];

export interface LineItemRecord {
	opportunityId: string;
	accountName: string;
	territory: string;
	forecast: string;
	skuName: string;
	fyb: number;
	category: "platform" | "shape" | "other";
}

export interface PipelineReportOptions {
	/** One or more Salesforce User IDs (AE + SE partner) for supplemental team-membership queries. */
	userIds: string[];
	orgAlias?: string;
	quarterStart: string;
	quarterEnd: string;
	/** Stale cutoff for in-play pipeline. Defaults to quarterEnd (in-quarter only).
	 * Set to 12 months ago to show all non-stale open pipeline regardless of close quarter. */
	staleCutoff?: string;
	/** Confirmed territories (operational field values). Primary query when set.
	 * Overlay teams should always set this — they're not tagged on most territory deals. */
	confirmedTerritories?: string[];
	/** Team member names for display (AE + SE). */
	teamMemberNames?: string[];
	/** SKU prefixes to include. Defaults to DEFAULT_SKU_PREFIXES. */
	skuPrefixes?: string[];
	/** SKU classification rules. Defaults to DEFAULT_SKU_CLASSIFICATION. */
	skuClassification?: SkuClassification;
}

export interface AccountRow {
	name: string;
	territory: string;
	platform: number;
	shape: number;
	other: number;
}

export interface SectionTotals {
	platform: number;
	shape: number;
	other: number;
}

export interface SectionData {
	accounts: AccountRow[];
	totals: SectionTotals;
	quotaTotal: number;
}

export interface ForecastSummary {
	commit: number;
	bestCase: number;
	pipeline: number;
}

export interface PipelineReportData {
	generated: string;
	quarter: { start: string; end: string };
	/** Territory coverage for display */
	territories: string[];
	/** Team member names for display */
	teamMembers: string[];
	/** Net New open pipeline by account (grouped by territory) */
	netNew: SectionData;
	/** Booked (won) this quarter by account */
	booked: SectionData;
	/** Open renewals by account (opportunity-level True_ACV, territory-scoped) */
	renewals: SectionData;
	/** Forecast summary for quota-eligible (Platform + Shape) — net new only */
	forecast: ForecastSummary;
	/** Total line items processed */
	lineItemCount: number;
	/** Distinct SKUs found */
	skusFound: string[];
	/** Data quality anomalies detected during report generation */
	anomalies: DataAnomaly[];
}

export interface DataAnomaly {
	severity: "info" | "warning" | "error";
	category: string;
	message: string;
	details?: string;
}
