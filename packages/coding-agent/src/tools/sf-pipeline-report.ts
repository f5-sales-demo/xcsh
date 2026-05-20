import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5xc-salesdemos/pi-agent-core";
import { $which, prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { loadSalesforceContext } from "../internal-urls/salesforce-context";
import { loadProfile } from "../internal-urls/user-profile";
import { generatePipelineReport, type SfQueryFn } from "../pipeline-report/generator";
import { renderPipelineReport } from "../pipeline-report/renderer";
import type { PipelineReportData, PipelineReportOptions } from "../pipeline-report/types";
import sfPipelineReportDescription from "../prompts/tools/sf-pipeline-report.md" with { type: "text" };
import type { ToolSession } from ".";
import { makeExecApi, type SfErrorType, type SfToolDetails } from "./sf";
import { execSfJson, SfAuthError, SfNoDefaultOrgError, SfSessionExpiredError } from "./sf/exec";
import { ORG_ALIAS_PATTERN } from "./sf/types";

const sfPipelineReportSchema = Type.Object({
	target_org: Type.Optional(Type.String({ description: "Org alias or username to run report against" })),
});

type SfPipelineReportInput = Static<typeof sfPipelineReportSchema>;

type SfResult = AgentToolResult<SfToolDetails> & { isError?: boolean };

function fiscalQuarterDates(): { start: string; end: string } {
	const now = new Date();
	const m = now.getMonth();
	const y = now.getFullYear();

	let start: Date;
	let end: Date;

	if (m >= 10) {
		start = new Date(y, 10, 1);
		end = new Date(y + 1, 1, 0);
	} else if (m === 0) {
		start = new Date(y - 1, 10, 1);
		end = new Date(y, 1, 0);
	} else if (m <= 3) {
		start = new Date(y, 1, 1);
		end = new Date(y, 4, 0);
	} else if (m <= 6) {
		start = new Date(y, 4, 1);
		end = new Date(y, 7, 0);
	} else {
		start = new Date(y, 7, 1);
		end = new Date(y, 10, 0);
	}

	const fmt = (d: Date) => d.toISOString().split("T")[0]!;
	return { start: fmt(start), end: fmt(end) };
}

function buildQueryFn(cwd: string, orgAlias?: string): SfQueryFn {
	const api = makeExecApi(cwd);
	return async (soql: string, queryOrgAlias?: string): Promise<Record<string, unknown>[]> => {
		const org = queryOrgAlias ?? orgAlias;
		const args = ["data", "query", "--query", soql];
		if (org) args.push("--target-org", org);
		try {
			const result = await execSfJson(api, args, undefined, soql);
			const data = result.result as { records?: Record<string, unknown>[] };
			return data.records ?? [];
		} catch {
			return [];
		}
	};
}

function detectErrorType(err: unknown): SfErrorType {
	if (err instanceof SfAuthError) return "auth_required";
	if (err instanceof SfSessionExpiredError) return "session_expired";
	if (err instanceof SfNoDefaultOrgError) return "no_default_org";
	return "exec_error";
}

export class SfPipelineReportTool implements AgentTool<typeof sfPipelineReportSchema, SfToolDetails> {
	readonly name = "sf_pipeline_report";
	readonly label = "Salesforce Pipeline Report";
	readonly description = prompt.render(sfPipelineReportDescription);
	readonly parameters = sfPipelineReportSchema;

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): SfPipelineReportTool | null {
		if (!$which("sf")) return null;
		return new SfPipelineReportTool(session);
	}

	async execute(
		_toolCallId: string,
		params: SfPipelineReportInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SfToolDetails>,
		_context?: AgentToolContext,
	): Promise<SfResult> {
		const base: SfToolDetails = { tool: "sf_pipeline_report" };

		if (params.target_org && !ORG_ALIAS_PATTERN.test(params.target_org)) {
			return {
				content: [
					{
						type: "text",
						text: `Error: invalid org alias "${params.target_org}". Only alphanumeric characters, dots, underscores, hyphens, and @ are allowed.`,
					},
				],
				isError: true,
				details: { ...base, errorType: "exec_error" },
			};
		}

		const profile = await loadProfile();
		const sfContext = await loadSalesforceContext();

		const userId = profile.identifiers?.salesforceId;
		if (!userId) {
			return {
				content: [
					{
						type: "text",
						text: "No Salesforce user ID found. Run sf_setup with action 'status' first, then read `xcsh://user` to confirm your salesforceId is set.",
					},
				],
				isError: true,
				details: { ...base, errorType: "auth_required" },
			};
		}

		const partnerId = profile.partner?.id;
		const userIds = partnerId ? [userId, partnerId] : [userId];
		const { start, end } = fiscalQuarterDates();

		const staleDate = new Date();
		staleDate.setFullYear(staleDate.getFullYear() - 1);
		const staleCutoff = staleDate.toISOString().split("T")[0]!;

		const partnerName = profile.partner?.name;
		const selfName = [profile.givenName, profile.familyName].filter(Boolean).join(" ").trim();
		const teamMemberNames = partnerName && selfName ? [selfName, partnerName] : selfName ? [selfName] : undefined;

		const orgAlias = params.target_org ?? sfContext?.orgAlias;

		const options: PipelineReportOptions = {
			userIds,
			orgAlias,
			quarterStart: start,
			quarterEnd: end,
			staleCutoff,
			confirmedTerritories: profile.territories ?? sfContext?.confirmedTerritories ?? sfContext?.territories,
			teamMemberNames,
		};

		try {
			const queryFn = buildQueryFn(this.session.cwd, orgAlias);
			const data: PipelineReportData = await generatePipelineReport(options, queryFn);
			const report = renderPipelineReport(data, sfContext?.instanceUrl ?? "");

			return {
				content: [{ type: "text", text: report }],
				details: { ...base, pipelineReport: data },
			};
		} catch (err) {
			const errorType = detectErrorType(err);
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: message }],
				isError: true,
				details: { ...base, errorType },
			};
		}
	}
}
