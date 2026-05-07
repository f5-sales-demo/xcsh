import * as os from "node:os";
import * as path from "node:path";
import { $which, isEnoent, logger } from "@f5xc-salesdemos/pi-utils";
import { $ } from "bun";
import { loadProfile } from "./user-profile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalesforcePartner {
	id: string;
	name: string;
	title?: string;
	/** "AE" = Account Executive/Manager, "SE" = Solutions Engineer */
	role: "AE" | "SE" | "other";
}

export interface TerritoryDetail {
	name: string;
	teamOpps: number;
	totalOpps: number;
	coverage: number; // teamOpps / totalOpps as percentage
}

export interface PipelineReportConfig {
	reportId: string;
	reportName: string;
	productSkus: string[];
	territoryFilter?: { field: string; operator: string; value: string };
	renewalFilter?: { field: string; value: string };
	groupingsDown: string[];
	groupingsAcross: string[];
	discoveredAt: string;
}

export interface DiscoveredSku {
	sku: string;
	fyb: number;
	count: number;
	inReportFilter: boolean;
}

export interface SalesforceContext {
	// Identity
	userId: string;
	username: string;
	instanceUrl: string;
	orgAlias?: string;

	// Role
	roleName?: string;

	/**
	 * Confirmed AE/SE partner. User-provided, not derived from manager chain.
	 * Manager hierarchy is unreliable (stale data, rehire scenarios, poor hygiene).
	 */
	confirmedPartner?: SalesforcePartner;

	// Manager chain — kept for reference, unreliable for team discovery
	managerId?: string;
	managerName?: string;
	team?: Array<{
		id: string;
		name: string;
		title?: string;
	}>;

	// Discovered pipeline universe
	territories?: string[];
	territoryDetails?: TerritoryDetail[];
	confirmedTerritories?: string[];
	productSegmentations?: string[];
	useCaseCategories?: string[];
	forecastCategories?: string[];
	stages?: string[];

	// Accounts with active pipeline
	activeAccounts?: Array<{
		name: string;
		oppCount: number;
	}>;

	// Org capabilities
	customFields?: {
		trueAcv: boolean;
		upsellAcv: boolean;
		productSegmentation: boolean;
		useCaseCategory: boolean;
		territory: boolean;
		renewal: boolean;
	};

	// Pipeline summary
	pipelineSummary?: {
		byForecast: Record<string, { amount: number; count: number }>;
		total: number;
		dealCount: number;
	};
	// Team member roles on opps
	teamRoles?: string[];

	// Pipeline report configuration (discovered from saved report)
	pipelineReportConfig?: PipelineReportConfig;

	// Product SKUs discovered from actual line items
	discoveredSkus?: DiscoveredSku[];

	// Meta
	collectedAt: string;
}

export interface SalesforceHint {
	pipelineTotal: string;
	dealCount: number;
	accountCount: number;
	territories?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SF_CONTEXT_PATH = path.join(os.homedir(), ".xcsh", "salesforce-context.json");
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadSalesforceContext(): Promise<SalesforceContext | null> {
	try {
		return (await Bun.file(SF_CONTEXT_PATH).json()) as SalesforceContext;
	} catch (err: unknown) {
		if (isEnoent(err)) return null;
		logger.warn("Failed to load salesforce context", { error: err });
		return null;
	}
}

export async function saveSalesforceContext(ctx: SalesforceContext): Promise<void> {
	ctx.collectedAt = new Date().toISOString();
	await Bun.write(SF_CONTEXT_PATH, JSON.stringify(ctx, null, 2));
}

export function salesforceContextIsStale(ctx: SalesforceContext): boolean {
	if (!ctx.collectedAt) return true;
	const age = Date.now() - new Date(ctx.collectedAt).getTime();
	return age > STALE_THRESHOLD_MS;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSfQuery(soql: string): Promise<Record<string, unknown>[]> {
	try {
		const escaped = soql.replace(/'/g, "'");
		const result = await $`sf data query --query ${escaped} --json`.quiet().nothrow();
		if (result.exitCode !== 0) return [];
		const parsed = JSON.parse(result.stdout.toString()) as {
			result?: { records?: Record<string, unknown>[] };
		};
		return parsed.result?.records ?? [];
	} catch (err: unknown) {
		logger.debug("SOQL query failed", { error: err });
		return [];
	}
}

async function getOrgInfo(): Promise<{ username: string; instanceUrl: string; alias: string } | null> {
	try {
		const result = await $`sf org display --json`.quiet().nothrow();
		if (result.exitCode !== 0) return null;
		const parsed = JSON.parse(result.stdout.toString()) as {
			result?: { username?: string; instanceUrl?: string; alias?: string };
		};
		const r = parsed.result;
		if (!r?.username || !r?.instanceUrl) return null;
		return { username: r.username, instanceUrl: r.instanceUrl, alias: r.alias ?? "" };
	} catch {
		return null;
	}
}

async function detectCustomFields(): Promise<SalesforceContext["customFields"]> {
	const defaults = {
		trueAcv: false,
		upsellAcv: false,
		productSegmentation: false,
		useCaseCategory: false,
		territory: false,
		renewal: false,
	};
	try {
		const result = await $`sf sobject describe --sobject Opportunity --json`.quiet().nothrow();
		if (result.exitCode !== 0) return defaults;
		const parsed = JSON.parse(result.stdout.toString()) as {
			result?: { fields?: Array<{ name: string }> };
		};
		const fieldNames = new Set((parsed.result?.fields ?? []).map(f => f.name));
		return {
			trueAcv: fieldNames.has("True_ACV__c"),
			upsellAcv: fieldNames.has("Upsell_ACV__c"),
			productSegmentation: fieldNames.has("Product_Segmentation__c"),
			useCaseCategory: fieldNames.has("Use_Case_Category__c"),
			territory: fieldNames.has("Territory_Credited_District_del__c"),
			renewal: fieldNames.has("Renewal__c"),
		};
	} catch {
		return defaults;
	}
}

// ---------------------------------------------------------------------------
// Discovery probes
// ---------------------------------------------------------------------------

async function discoverTerritories(
	userId: string,
	customFields: SalesforceContext["customFields"],
): Promise<Partial<SalesforceContext>> {
	if (!customFields?.territory) return {};

	// Step 1: Get territories where user is on opp team + count per territory
	const teamRecords = await runSfQuery(
		`SELECT Opportunity.Territory_Credited_District_del__c FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false AND Opportunity.Territory_Credited_District_del__c != null`,
	);
	const teamCounts = new Map<string, number>();
	for (const r of teamRecords) {
		const opp = r.Opportunity as Record<string, unknown> | undefined;
		const t = opp?.Territory_Credited_District_del__c as string | undefined;
		if (t) teamCounts.set(t, (teamCounts.get(t) ?? 0) + 1);
	}
	const territories = [...teamCounts.keys()].sort();
	if (territories.length === 0) return { territories: [] };

	// Step 2: Get total opps per territory individually (GROUP BY not supported on this field)
	const totalCounts = new Map<string, number>();
	const countPromises = territories.map(async t => {
		const escaped = t.replace(/'/g, "''");
		const recs = await runSfQuery(
			`SELECT COUNT(Id) FROM Opportunity WHERE Territory_Credited_District_del__c = '${escaped}' AND IsClosed = false`,
		);
		const cnt = (recs[0]?.expr0 ?? 0) as number;
		totalCounts.set(t, cnt);
	});
	await Promise.all(countPromises);

	// Step 3: Build territory details with coverage stats
	const territoryDetails: TerritoryDetail[] = territories.map(name => {
		const teamOpps = teamCounts.get(name) ?? 0;
		const totalOpps = totalCounts.get(name) ?? 0;
		const coverage = totalOpps > 0 ? Math.round((teamOpps / totalOpps) * 100) : 0;
		return { name, teamOpps, totalOpps, coverage };
	});

	// Sort by team opps descending (most engaged territories first)
	territoryDetails.sort((a, b) => b.teamOpps - a.teamOpps);

	return { territories, territoryDetails };
}

async function discoverAccounts(userId: string): Promise<Partial<SalesforceContext>> {
	const records = await runSfQuery(
		`SELECT COUNT(Id) cnt, Opportunity.Account.Name FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false GROUP BY Opportunity.Account.Name ORDER BY COUNT(Id) DESC LIMIT 30`,
	);
	const accounts = records
		.map(r => {
			// GROUP BY on relationship fields flattens to root — Account may appear at different nesting levels
			const name =
				((r as Record<string, unknown>).Name as string | undefined) ??
				(((r as Record<string, unknown>).Account as Record<string, unknown> | undefined)?.Name as
					| string
					| undefined);
			const cnt = (r.cnt ?? r.expr0) as number | undefined;
			if (!name || cnt == null) return null;
			return { name, oppCount: cnt };
		})
		.filter(Boolean) as Array<{ name: string; oppCount: number }>;
	return { activeAccounts: accounts };
}

async function discoverSegmentations(
	userId: string,
	customFields: SalesforceContext["customFields"],
): Promise<Partial<SalesforceContext>> {
	if (!customFields?.productSegmentation) return {};
	const records = await runSfQuery(
		`SELECT Product_Segmentation__c FROM Opportunity WHERE Id IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE UserId = '${userId}') AND IsClosed = false AND Product_Segmentation__c != null`,
	);
	const unique = [...new Set(records.map(r => r.Product_Segmentation__c as string).filter(Boolean))].sort();
	return { productSegmentations: unique };
}

async function discoverForecasts(userId: string): Promise<Partial<SalesforceContext>> {
	const records = await runSfQuery(
		`SELECT Opportunity.ForecastCategoryName, COUNT(Id) cnt FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false GROUP BY Opportunity.ForecastCategoryName`,
	);
	const unique = [
		...new Set(
			records
				.map(r => {
					const opp = r.Opportunity as Record<string, unknown> | undefined;
					return (opp?.ForecastCategoryName ?? r.ForecastCategoryName) as string | undefined;
				})
				.filter(Boolean) as string[],
		),
	];
	return { forecastCategories: unique };
}

async function discoverStages(userId: string): Promise<Partial<SalesforceContext>> {
	const records = await runSfQuery(
		`SELECT Opportunity.StageName, COUNT(Id) cnt FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false GROUP BY Opportunity.StageName ORDER BY COUNT(Id) DESC`,
	);
	const unique = [
		...new Set(
			records
				.map(r => {
					const opp = r.Opportunity as Record<string, unknown> | undefined;
					return (opp?.StageName ?? r.StageName) as string | undefined;
				})
				.filter(Boolean) as string[],
		),
	];
	return { stages: unique };
}

async function discoverPipelineSummary(userId: string): Promise<Partial<SalesforceContext>> {
	const records = await runSfQuery(
		`SELECT ForecastCategoryName, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE Id IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE UserId = '${userId}') AND IsClosed = false GROUP BY ForecastCategoryName ORDER BY SUM(Amount) DESC`,
	);
	const byForecast: Record<string, { amount: number; count: number }> = {};
	let total = 0;
	let dealCount = 0;
	for (const r of records) {
		const cat = r.ForecastCategoryName as string | undefined;
		if (!cat) continue;
		const amount = (r.total ?? 0) as number;
		const count = (r.cnt ?? r.expr0 ?? 0) as number;
		byForecast[cat] = { amount, count };
		total += amount;
		dealCount += count;
	}
	return { pipelineSummary: { byForecast, total, dealCount } };
}

async function discoverTeamRoles(userId: string): Promise<Partial<SalesforceContext>> {
	const records = await runSfQuery(
		`SELECT TeamMemberRole, COUNT(Id) cnt FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false GROUP BY TeamMemberRole`,
	);
	const unique = [...new Set(records.map(r => r.TeamMemberRole as string | undefined).filter(Boolean) as string[])];
	return { teamRoles: unique };
}

async function discoverRoleAndTeam(userId: string): Promise<Partial<SalesforceContext>> {
	const userRecords = await runSfQuery(
		`SELECT UserRole.Name, ManagerId, Manager.Name FROM User WHERE Id = '${userId}'`,
	);
	if (userRecords.length === 0) return {};
	const user = userRecords[0];
	const roleObj = user.UserRole as Record<string, unknown> | undefined;
	const managerObj = user.Manager as Record<string, unknown> | undefined;
	const roleName = (roleObj?.Name as string | undefined) ?? undefined;
	const managerId = (user.ManagerId as string | undefined) ?? undefined;
	const managerName = (managerObj?.Name as string | undefined) ?? undefined;

	const result: Partial<SalesforceContext> = { roleName, managerId, managerName };

	if (managerId) {
		const teamRecords = await runSfQuery(
			`SELECT Id, Name, Title FROM User WHERE ManagerId = '${managerId}' AND IsActive = true ORDER BY Name`,
		);
		result.team = teamRecords.map(r => ({
			id: r.Id as string,
			name: r.Name as string,
			title: (r.Title as string | undefined) ?? undefined,
		}));
	}

	return result;
}

// ---------------------------------------------------------------------------
// Main discovery
// ---------------------------------------------------------------------------

export async function discoverSalesforceContext(): Promise<SalesforceContext | null> {
	if (!$which("sf")) return null;

	const orgInfo = await getOrgInfo();
	if (!orgInfo) return null;

	const profile = await loadProfile();
	const userId = profile.identifiers?.salesforceId;
	if (!userId) return null;

	const customFields = await detectCustomFields();

	const results = await Promise.all([
		discoverTerritories(userId, customFields).catch(() => ({})),
		discoverAccounts(userId).catch(() => ({})),
		discoverSegmentations(userId, customFields).catch(() => ({})),
		discoverForecasts(userId).catch(() => ({})),
		discoverStages(userId).catch(() => ({})),
		discoverPipelineSummary(userId).catch(() => ({})),
		discoverTeamRoles(userId).catch(() => ({})),
		discoverRoleAndTeam(userId).catch(() => ({})),
	]);

	const merged: SalesforceContext = {
		userId,
		username: orgInfo.username,
		instanceUrl: orgInfo.instanceUrl,
		orgAlias: orgInfo.alias || undefined,
		customFields,
		collectedAt: new Date().toISOString(),
	};
	for (const partial of results) {
		Object.assign(merged, partial);
	}

	return merged;
}

export async function seedSalesforceContext(): Promise<SalesforceContext | null> {
	const ctx = await discoverSalesforceContext();
	if (ctx) {
		await saveSalesforceContext(ctx);
	}
	return ctx;
}

// ---------------------------------------------------------------------------
// Hint builder
// ---------------------------------------------------------------------------

export function buildSalesforceHint(ctx: SalesforceContext | null): SalesforceHint | undefined {
	if (!ctx?.pipelineSummary) return undefined;
	const total = ctx.pipelineSummary.total;
	const formatted =
		total >= 1_000_000
			? `$${(total / 1_000_000).toFixed(1)}M`
			: total >= 1_000
				? `$${(total / 1_000).toFixed(0)}K`
				: `$${total.toFixed(0)}`;
	const topTerritories = ctx.territories?.slice(0, 3).join(", ");
	return {
		pipelineTotal: formatted,
		dealCount: ctx.pipelineSummary.dealCount,
		accountCount: ctx.activeAccounts?.length ?? 0,
		territories: topTerritories,
	};
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function renderSalesforceContextMarkdown(ctx: SalesforceContext | null): string {
	if (!ctx) {
		return "No Salesforce context. Use `xcsh://salesforce?refresh=true` to discover.";
	}

	const sections: string[] = [];

	sections.push("# Salesforce Context");
	sections.push(`**User:** ${ctx.username}`);
	sections.push(`**Instance:** ${ctx.instanceUrl}`);
	if (ctx.orgAlias) sections.push(`**Org Alias:** ${ctx.orgAlias}`);
	if (ctx.roleName) sections.push(`**Role:** ${ctx.roleName}`);

	// Pipeline Summary
	if (ctx.pipelineSummary) {
		sections.push("\n## Pipeline Summary");
		const hint = buildSalesforceHint(ctx);
		if (hint) {
			sections.push(`**Total Pipeline:** ${hint.pipelineTotal} across ${hint.dealCount} deals`);
		}
		const entries = Object.entries(ctx.pipelineSummary.byForecast);
		if (entries.length > 0) {
			sections.push("\n| Forecast Category | Amount | Deals |");
			sections.push("|---|---|---|");
			for (const [cat, { amount, count }] of entries) {
				const fmt =
					amount >= 1_000_000
						? `$${(amount / 1_000_000).toFixed(1)}M`
						: amount >= 1_000
							? `$${(amount / 1_000).toFixed(0)}K`
							: `$${amount.toFixed(0)}`;
				sections.push(`| ${cat} | ${fmt} | ${count} |`);
			}
		}
	}

	// Active Accounts
	if (ctx.activeAccounts && ctx.activeAccounts.length > 0) {
		sections.push("\n## Active Accounts");
		sections.push(`${ctx.activeAccounts.length} accounts with open pipeline:\n`);
		for (const acct of ctx.activeAccounts) {
			sections.push(`- **${acct.name}** (${acct.oppCount} opps)`);
		}
	}

	// Territories
	if (ctx.territoryDetails && ctx.territoryDetails.length > 0) {
		const confirmed = new Set(ctx.confirmedTerritories ?? []);
		const hasConfirmed = confirmed.size > 0;
		sections.push("\n## Territories");
		if (!hasConfirmed) {
			sections.push("\n> **Action needed:** Confirm which territories are your primary responsibility.");
			sections.push("> High team-opp coverage suggests primary ownership. Low coverage suggests overlay.\n");
		}
		sections.push("| Territory | Your Opps | Total | Coverage | Status |");
		sections.push("|---|---|---|---|---|");
		for (const td of ctx.territoryDetails) {
			const status = hasConfirmed
				? confirmed.has(td.name)
					? "Primary"
					: "Overlay"
				: td.coverage >= 20
					? "Likely primary"
					: "Likely overlay";
			sections.push(`| ${td.name} | ${td.teamOpps} | ${td.totalOpps} | ${td.coverage}% | ${status} |`);
		}
	} else if (ctx.territories && ctx.territories.length > 0) {
		sections.push("\n## Territories");
		for (const t of ctx.territories) {
			sections.push(`- ${t}`);
		}
	}

	// Product Segmentations
	if (ctx.productSegmentations && ctx.productSegmentations.length > 0) {
		sections.push("\n## Product Segmentations");
		for (const s of ctx.productSegmentations) {
			sections.push(`- ${s}`);
		}
	}

	// Stages
	if (ctx.stages && ctx.stages.length > 0) {
		sections.push("\n## Stages");
		for (const s of ctx.stages) {
			sections.push(`- ${s}`);
		}
	}

	// Team Roles
	if (ctx.teamRoles && ctx.teamRoles.length > 0) {
		sections.push("\n## Team Member Roles");
		for (const r of ctx.teamRoles) {
			sections.push(`- ${r}`);
		}
	}

	// Team
	if (ctx.managerName || (ctx.team && ctx.team.length > 0)) {
		sections.push("\n## Team");
		if (ctx.managerName) {
			sections.push(`**Manager:** ${ctx.managerName}`);
		}
		if (ctx.team && ctx.team.length > 0) {
			sections.push(`\n**Direct Reports** (${ctx.team.length}):\n`);
			for (const member of ctx.team) {
				const title = member.title ? ` — ${member.title}` : "";
				sections.push(`- ${member.name}${title}`);
			}
		}
	}

	// Org Capabilities
	if (ctx.customFields) {
		sections.push("\n## Org Capabilities");
		const fields = ctx.customFields;
		const enabled = Object.entries(fields)
			.filter(([, v]) => v)
			.map(([k]) => k);
		if (enabled.length > 0) {
			sections.push(`Custom fields detected: ${enabled.join(", ")}`);
		} else {
			sections.push("No custom opportunity fields detected.");
		}
	}

	// Footer
	sections.push(`\n---\n*Collected: ${ctx.collectedAt}*`);

	return sections.join("\n");
}
