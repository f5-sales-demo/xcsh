import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5xc-salesdemos/pi-agent-core";
import { $which, prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import sfOrgDisplayDescription from "../prompts/tools/sf-org-display.md" with { type: "text" };
import sfQueryDescription from "../prompts/tools/sf-query.md" with { type: "text" };
import sfSetupDescription from "../prompts/tools/sf-setup.md" with { type: "text" };
import type { ToolSession } from ".";
import { loadUserProfile, saveUserProfile } from "./sf/config";
import type { SfExecApi } from "./sf/exec";
import { execSfJson, execSfRaw } from "./sf/exec";
import { formatOrgDetail, formatOrgTable, formatQueryResults, formatUserProfile } from "./sf/formatters";
import type { SfOrg, SfQueryResult, SfRawResult, SfUserProfile } from "./sf/types";
import { ORG_ALIAS_PATTERN, USER_PROFILE_SOQL } from "./sf/types";

function makeExecApi(cwd: string): SfExecApi {
	return {
		async exec(command: string, args: string[], _options?: { signal?: AbortSignal }): Promise<SfRawResult> {
			// Never pass signal to Bun.spawn and never pre-check signal.aborted.
			// sf commands finish in 1-5s. Passing the signal or pre-checking causes
			// false cancellations when xcsh's AbortSignal fires between multi-turn
			// tool calls (the signal is stale from a prior turn).
			const child = Bun.spawn([command, ...args], {
				cwd,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			if (!child.stdout || !child.stderr) {
				return { stdout: "", stderr: "Failed to capture output", exitCode: 1 };
			}
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return {
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: exitCode ?? 0,
			};
		},
	};
}

// ─── Schemas ─────────────────────────────────────────────────────────────

const sfSetupSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("check"),
			Type.Literal("status"),
			Type.Literal("login"),
			Type.Literal("list_orgs"),
			Type.Literal("set_default"),
			Type.Literal("profile"),
		],
		{ description: "Onboarding action to perform" },
	),
	org: Type.Optional(Type.String({ description: "Org alias (used with set_default)" })),
});

const sfQuerySchema = Type.Object({
	query: Type.String({ description: "SOQL query to execute" }),
	target_org: Type.Optional(Type.String({ description: "Org alias or username to query against" })),
});

const sfOrgDisplaySchema = Type.Object({
	target_org: Type.Optional(Type.String({ description: "Org alias or username to display" })),
});

type SfSetupInput = Static<typeof sfSetupSchema>;
type SfQueryInput = Static<typeof sfQuerySchema>;
type SfOrgDisplayInput = Static<typeof sfOrgDisplaySchema>;

interface SfToolDetails {
	orgs?: SfOrg[];
	queryResult?: SfQueryResult;
	profile?: SfUserProfile;
}

function textResult(text: string, details?: SfToolDetails): AgentToolResult<SfToolDetails> {
	return { content: [{ type: "text", text }], details };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function normalizeOrg(raw: Record<string, unknown>): SfOrg {
	return {
		alias: raw.alias as string | undefined,
		username: raw.username as string,
		orgId: (raw.orgId ?? raw.orgid) as string,
		instanceUrl: raw.instanceUrl as string,
		connectedStatus: (raw.connectedStatus ?? "Unknown") as string,
		isDefault: Boolean(raw.isDefaultUsername) || String(raw.defaultMarker ?? "").includes("(U)"),
		isSandbox: Boolean(raw.isSandbox),
	};
}

function normalizeOrgList(rawOrgs: Record<string, unknown>[]): SfOrg[] {
	return (rawOrgs ?? []).map(normalizeOrg);
}

function extractRelationshipField(
	record: Record<string, unknown>,
	relationship: string,
	field: string,
): string | undefined {
	const related = record[relationship];
	if (related && typeof related === "object" && !Array.isArray(related)) {
		const value = (related as Record<string, unknown>)[field];
		if (value) return String(value);
	}
	return undefined;
}

// ─── SfSetupTool ─────────────────────────────────────────────────────────

export class SfSetupTool implements AgentTool<typeof sfSetupSchema, SfToolDetails> {
	readonly name = "sf_setup";
	readonly label = "Salesforce Setup";
	readonly description = prompt.render(sfSetupDescription);
	readonly parameters = sfSetupSchema;

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): SfSetupTool | null {
		if (!$which("sf")) return null;
		return new SfSetupTool(session);
	}

	async execute(
		_toolCallId: string,
		params: SfSetupInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SfToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SfToolDetails>> {
		const api = makeExecApi(this.session.cwd);

		switch (params.action) {
			case "check": {
				const result = await execSfRaw(api, ["--version"], signal);
				return textResult(`sf is installed: ${result.stdout}`);
			}

			case "status": {
				const orgResult = await execSfJson(api, ["org", "list"], signal);
				const orgList = orgResult.result as Record<string, unknown[]>;
				const allOrgs = [
					...normalizeOrgList((orgList.nonScratchOrgs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.scratchOrgs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.sandboxes ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.devHubs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.other ?? []) as Record<string, unknown>[]),
				];
				let output = formatOrgTable(allOrgs);

				const cached = await loadUserProfile();
				if (cached) {
					output += `\n\nCached user profile: **${cached.firstName} ${cached.lastName}** (${cached.username}), fetched ${cached.fetchedAt}`;
				}

				return textResult(output, { orgs: allOrgs });
			}

			case "login": {
				const orgResult = await execSfJson(api, ["org", "list"], signal);
				const orgList = orgResult.result as Record<string, unknown[]>;
				const allOrgs = [
					...normalizeOrgList((orgList.nonScratchOrgs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.scratchOrgs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.sandboxes ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.devHubs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.other ?? []) as Record<string, unknown>[]),
				];
				if (allOrgs.length > 0) {
					return textResult("Already authenticated. Use 'profile' action to extract your user data.", {
						orgs: allOrgs,
					});
				}
				return textResult(
					"No authenticated orgs found.\n\nRun one of these commands to authenticate:\n" +
						"- **Workstation**: `sf org login web --set-default --alias SFDC`\n" +
						'- **Container**: `echo "$SFDX_AUTH_URL" | sf org login sfdx-url --sfdx-url-stdin=- --set-default --alias f5`\n\n' +
						"After authenticating, call sf_setup with action 'status' to confirm.",
				);
			}

			case "list_orgs": {
				const orgResult = await execSfJson(api, ["org", "list"], signal);
				const orgList = orgResult.result as Record<string, unknown[]>;
				const allOrgs = [
					...normalizeOrgList((orgList.nonScratchOrgs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.scratchOrgs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.sandboxes ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.devHubs ?? []) as Record<string, unknown>[]),
					...normalizeOrgList((orgList.other ?? []) as Record<string, unknown>[]),
				];
				return textResult(formatOrgTable(allOrgs), { orgs: allOrgs });
			}

			case "set_default": {
				if (!params.org) {
					return textResult("Error: org parameter is required for set_default action.");
				}
				if (!ORG_ALIAS_PATTERN.test(params.org)) {
					return textResult(
						`Error: invalid org alias "${params.org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
					);
				}
				await execSfRaw(api, ["config", "set", "target-org", params.org, "--global"], signal);
				return textResult(`Default org set to: **${params.org}**`);
			}

			case "profile": {
				// Step 1: Get the current user's username from org display
				const orgInfo = await execSfJson(api, ["org", "display"], signal);
				const orgResult = orgInfo.result as Record<string, unknown>;
				const username = orgResult.username as string;
				if (!username) {
					return textResult("Could not determine username from org display. Ensure a default org is set.");
				}

				// Step 2: Build and run SOQL query for user profile
				const soql = USER_PROFILE_SOQL.replace("{username}", username);
				const queryResult = await execSfJson(api, ["data", "query", "--query", soql], signal, soql);
				const queryData = queryResult.result as SfQueryResult<Record<string, unknown>>;

				if (!queryData.records || queryData.records.length === 0) {
					return textResult(`No user record found for username: ${username}`);
				}

				const record = queryData.records[0];

				// Step 3: Map SOQL fields to SfUserProfile
				const profile: SfUserProfile = {
					userId: String(record.Id ?? ""),
					username: String(record.Username ?? ""),
					firstName: String(record.FirstName ?? ""),
					lastName: String(record.LastName ?? ""),
					email: String(record.Email ?? ""),
					title: record.Title ? String(record.Title) : undefined,
					department: record.Department ? String(record.Department) : undefined,
					division: record.Division ? String(record.Division) : undefined,
					companyName: record.CompanyName ? String(record.CompanyName) : undefined,
					aboutMe: record.AboutMe ? String(record.AboutMe) : undefined,
					managerId: record.ManagerId ? String(record.ManagerId) : undefined,
					managerName: extractRelationshipField(record, "Manager", "Name"),
					managerEmail: extractRelationshipField(record, "Manager", "Email"),
					role: extractRelationshipField(record, "UserRole", "Name"),
					profile: extractRelationshipField(record, "Profile", "Name"),
					phone: record.Phone || record.MobilePhone ? String(record.Phone ?? record.MobilePhone) : undefined,
					street: record.Street ? String(record.Street) : undefined,
					city: record.City ? String(record.City) : undefined,
					state: record.State ? String(record.State) : undefined,
					postalCode: record.PostalCode ? String(record.PostalCode) : undefined,
					country: record.Country ? String(record.Country) : undefined,
					fetchedAt: new Date().toISOString(),
				};

				// Step 4: Cache the profile
				await saveUserProfile(profile);

				return textResult(formatUserProfile(profile), { profile });
			}

			default:
				return textResult(`Unknown action: ${params.action}`);
		}
	}
}

// ─── SfQueryTool ─────────────────────────────────────────────────────────

export class SfQueryTool implements AgentTool<typeof sfQuerySchema, SfToolDetails> {
	readonly name = "sf_query";
	readonly label = "Salesforce Query";
	readonly description = prompt.render(sfQueryDescription);
	readonly parameters = sfQuerySchema;

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): SfQueryTool | null {
		if (!$which("sf")) return null;
		return new SfQueryTool(session);
	}

	async execute(
		_toolCallId: string,
		params: SfQueryInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SfToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SfToolDetails>> {
		const api = makeExecApi(this.session.cwd);

		if (params.target_org && !ORG_ALIAS_PATTERN.test(params.target_org)) {
			return textResult(
				`Error: invalid org alias "${params.target_org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
			);
		}

		const args = ["data", "query", "--query", params.query];
		if (params.target_org) {
			args.push("--target-org", params.target_org);
		}

		const result = await execSfJson(api, args, signal, params.query);
		const queryData = result.result as SfQueryResult<Record<string, unknown>>;

		const queryResult: SfQueryResult = {
			totalSize: queryData.totalSize ?? 0,
			done: queryData.done ?? true,
			records: queryData.records ?? [],
		};

		return textResult(formatQueryResults(queryResult), { queryResult });
	}
}

// ─── SfOrgDisplayTool ────────────────────────────────────────────────────

export class SfOrgDisplayTool implements AgentTool<typeof sfOrgDisplaySchema, SfToolDetails> {
	readonly name = "sf_org_display";
	readonly label = "Salesforce Org Display";
	readonly description = prompt.render(sfOrgDisplayDescription);
	readonly parameters = sfOrgDisplaySchema;

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): SfOrgDisplayTool | null {
		if (!$which("sf")) return null;
		return new SfOrgDisplayTool(session);
	}

	async execute(
		_toolCallId: string,
		params: SfOrgDisplayInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SfToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SfToolDetails>> {
		const api = makeExecApi(this.session.cwd);

		if (params.target_org && !ORG_ALIAS_PATTERN.test(params.target_org)) {
			return textResult(
				`Error: invalid org alias "${params.target_org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
			);
		}

		const args = ["org", "display"];
		if (params.target_org) {
			args.push("--target-org", params.target_org);
		}

		const result = await execSfJson(api, args, signal);
		const raw = result.result as Record<string, unknown>;

		// SECURITY: only extract whitelisted fields
		const org: SfOrg = {
			username: String(raw.username ?? ""),
			orgId: String(raw.id ?? raw.orgId ?? ""),
			instanceUrl: String(raw.instanceUrl ?? ""),
			connectedStatus: String(raw.connectedStatus ?? "Connected"),
			alias: raw.alias ? String(raw.alias) : undefined,
			isDefault: false,
			isSandbox: Boolean(raw.isSandbox ?? false),
		};

		return textResult(formatOrgDetail(org), { orgs: [org] });
	}
}
