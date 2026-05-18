import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5xc-salesdemos/pi-agent-core";
import { $which, prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { loadProfile } from "../internal-urls/user-profile";
import sfOrgDisplayDescription from "../prompts/tools/sf-org-display.md" with { type: "text" };
import sfQueryDescription from "../prompts/tools/sf-query.md" with { type: "text" };
import sfSetupDescription from "../prompts/tools/sf-setup.md" with { type: "text" };
import type { ToolSession } from ".";
import type { SfExecApi } from "./sf/exec";
import {
	execSfJson,
	execSfRaw,
	SfAuthError,
	SfNoDefaultOrgError,
	SfQueryError,
	SfSessionExpiredError,
} from "./sf/exec";
import { formatOrgDetail, formatOrgTable, formatQueryResults } from "./sf/formatters";
import type { SfOrg, SfQueryResult, SfRawResult } from "./sf/types";
import { ORG_ALIAS_PATTERN } from "./sf/types";

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
		],
		{ description: "Onboarding action to perform" },
	),
	org: Type.Optional(Type.String({ description: "Org alias (used with set_default)" })),
});

const sfQuerySchema = Type.Object({
	query: Type.String({ description: "SOQL query to execute" }),
	target_org: Type.Optional(Type.String({ description: "Org alias or username to query against" })),
	use_tooling_api: Type.Optional(
		Type.Boolean({ description: "Use Tooling API to query metadata objects like ApexTrigger" }),
	),
	all_rows: Type.Optional(Type.Boolean({ description: "Include deleted records in results" })),
});

const sfOrgDisplaySchema = Type.Object({
	target_org: Type.Optional(Type.String({ description: "Org alias or username to display" })),
});

type SfSetupInput = Static<typeof sfSetupSchema>;
type SfQueryInput = Static<typeof sfQuerySchema>;
type SfOrgDisplayInput = Static<typeof sfOrgDisplaySchema>;

export type SfErrorType = "auth_required" | "session_expired" | "no_default_org" | "invalid_query" | "exec_error";

export interface SfToolDetails {
	tool: "sf_setup" | "sf_query" | "sf_org_display";
	action?: string;
	orgs?: SfOrg[];
	queryResult?: SfQueryResult;
	errorType?: SfErrorType;
}

type SfResult = AgentToolResult<SfToolDetails> & { isError?: boolean };

function textResult(text: string, details: SfToolDetails): SfResult {
	return { content: [{ type: "text", text }], details };
}

function errorResult(text: string, details: SfToolDetails): SfResult {
	return { content: [{ type: "text", text }], isError: true, details };
}

function detectErrorType(err: unknown): SfErrorType {
	if (err instanceof SfAuthError) return "auth_required";
	if (err instanceof SfSessionExpiredError) return "session_expired";
	if (err instanceof SfNoDefaultOrgError) return "no_default_org";
	if (err instanceof SfQueryError) return "invalid_query";
	return "exec_error";
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

export function collectAllOrgs(orgList: Record<string, unknown[]>): SfOrg[] {
	const all = [
		...normalizeOrgList((orgList.nonScratchOrgs ?? []) as Record<string, unknown>[]),
		...normalizeOrgList((orgList.scratchOrgs ?? []) as Record<string, unknown>[]),
		...normalizeOrgList((orgList.sandboxes ?? []) as Record<string, unknown>[]),
		...normalizeOrgList((orgList.devHubs ?? []) as Record<string, unknown>[]),
		...normalizeOrgList((orgList.other ?? []) as Record<string, unknown>[]),
	];
	const seen = new Set<string>();
	return all.filter(org => {
		if (seen.has(org.orgId)) return false;
		seen.add(org.orgId);
		return true;
	});
}

// ─── SfSetupTool ─────────────────────────────────────────────────────────

export class SfSetupTool implements AgentTool<typeof sfSetupSchema, SfToolDetails> {
	readonly name = "sf_setup";
	readonly label = "Salesforce Setup";
	readonly description = prompt.render(sfSetupDescription);
	readonly parameters = sfSetupSchema;

	#testApi?: SfExecApi;
	constructor(
		readonly session: ToolSession,
		testApi?: SfExecApi,
	) {
		this.#testApi = testApi;
	}

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
	): Promise<SfResult> {
		const api = this.#testApi ?? makeExecApi(this.session.cwd);
		const base = { tool: "sf_setup" as const, action: params.action };

		try {
			switch (params.action) {
				case "check": {
					const result = await execSfRaw(api, ["--version"], signal);
					return textResult(`sf is installed: ${result.stdout}`, base);
				}

				case "status": {
					const orgResult = await execSfJson(api, ["org", "list"], signal);
					const allOrgs = collectAllOrgs(orgResult.result as Record<string, unknown[]>);
					let output = formatOrgTable(allOrgs);

					const userProfile = await loadProfile();
					if (userProfile.givenName || userProfile.familyName) {
						const name = [userProfile.givenName, userProfile.familyName].filter(Boolean).join(" ");
						output += `\n\nUser profile: **${name}** (${userProfile.email ?? "no email"})`;
					}

					return textResult(output, { ...base, orgs: allOrgs });
				}

				case "login": {
					const orgResult = await execSfJson(api, ["org", "list"], signal);
					const allOrgs = collectAllOrgs(orgResult.result as Record<string, unknown[]>);
					if (allOrgs.length > 0) {
						return textResult("Already authenticated. Use 'status' action to see your orgs and profile.", {
							...base,
							orgs: allOrgs,
						});
					}
					return textResult(
						"No authenticated orgs found.\n\nRun one of these commands to authenticate:\n" +
							"- **Workstation**: `sf org login web --set-default --alias SFDC`\n" +
							'- **Container**: `echo "$SFDX_AUTH_URL" | sf org login sfdx-url --sfdx-url-stdin=- --set-default --alias f5`\n\n' +
							"After authenticating, call sf_setup with action 'status' to confirm.",
						base,
					);
				}

				case "list_orgs": {
					const orgResult = await execSfJson(api, ["org", "list"], signal);
					const allOrgs = collectAllOrgs(orgResult.result as Record<string, unknown[]>);
					return textResult(formatOrgTable(allOrgs), { ...base, orgs: allOrgs });
				}

				case "set_default": {
					if (!params.org) {
						return errorResult("Error: org parameter is required for set_default action.", base);
					}
					if (!ORG_ALIAS_PATTERN.test(params.org)) {
						return errorResult(
							`Error: invalid org alias "${params.org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
							base,
						);
					}
					await execSfRaw(api, ["config", "set", "target-org", params.org, "--global"], signal);
					return textResult(`Default org set to: **${params.org}**`, base);
				}

				default:
					return textResult(`Unknown action: ${params.action}`, base);
			}
		} catch (err) {
			const errorType = detectErrorType(err);
			const message = err instanceof Error ? err.message : String(err);
			return errorResult(message, { ...base, errorType });
		}
	}
}

// ─── SfQueryTool ─────────────────────────────────────────────────────────

export class SfQueryTool implements AgentTool<typeof sfQuerySchema, SfToolDetails> {
	readonly name = "sf_query";
	readonly label = "Salesforce Query";
	readonly description = prompt.render(sfQueryDescription);
	readonly parameters = sfQuerySchema;

	#testApi?: SfExecApi;
	constructor(
		readonly session: ToolSession,
		testApi?: SfExecApi,
	) {
		this.#testApi = testApi;
	}

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
	): Promise<SfResult> {
		const api = this.#testApi ?? makeExecApi(this.session.cwd);
		const base = { tool: "sf_query" as const, action: "query" };

		if (params.target_org && !ORG_ALIAS_PATTERN.test(params.target_org)) {
			return errorResult(
				`Error: invalid org alias "${params.target_org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
				base,
			);
		}

		const args = ["data", "query", "--query", params.query];
		if (params.target_org) args.push("--target-org", params.target_org);
		if (params.use_tooling_api) args.push("--use-tooling-api");
		if (params.all_rows) args.push("--all-rows");

		try {
			const result = await execSfJson(api, args, signal, params.query);
			const queryData = result.result as SfQueryResult<Record<string, unknown>>;
			const queryResult: SfQueryResult = {
				totalSize: queryData.totalSize ?? 0,
				done: queryData.done ?? true,
				records: queryData.records ?? [],
			};

			let output = formatQueryResults(queryResult);
			if (!queryResult.done) {
				output +=
					"\n\n**Warning**: Results are incomplete. The query returned more records than the API limit. Use `sf data export bulk` for the full dataset.";
			}
			return textResult(output, { ...base, queryResult });
		} catch (err) {
			const errorType = detectErrorType(err);
			const message = err instanceof Error ? err.message : String(err);
			return errorResult(message, { ...base, errorType });
		}
	}
}

// ─── SfOrgDisplayTool ────────────────────────────────────────────────────

export class SfOrgDisplayTool implements AgentTool<typeof sfOrgDisplaySchema, SfToolDetails> {
	readonly name = "sf_org_display";
	readonly label = "Salesforce Org Display";
	readonly description = prompt.render(sfOrgDisplayDescription);
	readonly parameters = sfOrgDisplaySchema;

	#testApi?: SfExecApi;
	constructor(
		readonly session: ToolSession,
		testApi?: SfExecApi,
	) {
		this.#testApi = testApi;
	}

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
	): Promise<SfResult> {
		const api = this.#testApi ?? makeExecApi(this.session.cwd);
		const base = { tool: "sf_org_display" as const };

		if (params.target_org && !ORG_ALIAS_PATTERN.test(params.target_org)) {
			return errorResult(
				`Error: invalid org alias "${params.target_org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
				base,
			);
		}

		const args = ["org", "display"];
		if (params.target_org) args.push("--target-org", params.target_org);

		try {
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

			return textResult(formatOrgDetail(org), { ...base, orgs: [org] });
		} catch (err) {
			const errorType = detectErrorType(err);
			const message = err instanceof Error ? err.message : String(err);
			return errorResult(message, { ...base, errorType });
		}
	}
}
