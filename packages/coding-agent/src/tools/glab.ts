import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5xc-salesdemos/pi-agent-core";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import glabIssueListDescription from "../prompts/tools/glab-issue-list.md" with { type: "text" };
import glabIssueViewDescription from "../prompts/tools/glab-issue-view.md" with { type: "text" };
import glabSearchDescription from "../prompts/tools/glab-search.md" with { type: "text" };
import glabSetupDescription from "../prompts/tools/glab-setup.md" with { type: "text" };
import * as git from "../utils/git";
import type { ToolSession } from ".";
import { loadConfig, resolveProject, saveConfig } from "./glab/config";
import type { GlabExecApi } from "./glab/exec";
import { checkAuth, checkInstalled, execGlabJson, GlabAuthError } from "./glab/exec";
import { formatIssueDetail, formatIssueTable } from "./glab/formatters";
import { executeGraphQL } from "./glab/graphql";
import type { GlabIssue, GlabProject, GraphQLIssueNode } from "./glab/types";

function makeExecApi(cwd: string): GlabExecApi {
	return {
		cwd,
		async exec(command: string, args: string[], options?: { signal?: AbortSignal; cwd?: string }) {
			// Never pass signal to Bun.spawn and never pre-check signal.aborted.
			// glab commands finish in 1-3s. Passing the signal or pre-checking causes
			// false cancellations when xcsh's AbortSignal fires between multi-turn
			// tool calls (the signal is stale from a prior turn).
			const child = Bun.spawn([command, ...args], {
				cwd: options?.cwd ?? cwd,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			if (!child.stdout || !child.stderr) {
				return { stdout: "", stderr: "Failed to capture output", code: 1, killed: false };
			}
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return {
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				code: exitCode ?? 0,
				killed: child.killed,
			};
		},
	};
}

// ─── Schemas ─────────────────────────────────────────────────────────────

const glabSetupSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("check"),
			Type.Literal("login"),
			Type.Literal("select_project"),
			Type.Literal("save_project"),
			Type.Literal("status"),
		],
		{ description: "Onboarding action to perform" },
	),
	project: Type.Optional(Type.String({ description: "Project path to persist (used with save_project)" })),
});

const glabIssueListSchema = Type.Object({
	project: Type.Optional(
		Type.String({ description: "GitLab project path (e.g. group/repo). Defaults to configured project." }),
	),
	state: Type.Optional(
		Type.Union([Type.Literal("opened"), Type.Literal("closed"), Type.Literal("all")], {
			description: "Filter by issue state",
		}),
	),
	labels: Type.Optional(Type.Array(Type.String(), { description: "Filter by labels" })),
	assignee: Type.Optional(Type.String({ description: "Filter by assignee username" })),
	search: Type.Optional(Type.String({ description: "Search text in title and description" })),
	milestone: Type.Optional(Type.String()),
	sort: Type.Optional(
		Type.Union(
			[Type.Literal("created_at"), Type.Literal("updated_at"), Type.Literal("priority"), Type.Literal("due_date")],
			{ description: "Sort field" },
		),
	),
	order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")], { description: "Sort direction" })),
	limit: Type.Optional(Type.Number({ default: 30, maximum: 100, description: "Max results" })),
});

const glabIssueViewSchema = Type.Object({
	issue: Type.Union([Type.Number(), Type.String()], { description: "Issue IID number or full URL" }),
	project: Type.Optional(Type.String()),
	comments: Type.Optional(Type.Boolean({ default: true })),
});

const glabSearchSchema = Type.Object({
	query: Type.String({ description: "Search text to find across issue titles, descriptions, labels, and comments" }),
	project: Type.Optional(Type.String()),
	state: Type.Optional(
		Type.Union([Type.Literal("opened"), Type.Literal("closed"), Type.Literal("all")], {
			description: "Filter by issue state",
		}),
	),
	labels: Type.Optional(Type.Array(Type.String())),
	limit: Type.Optional(Type.Number({ default: 20, maximum: 100 })),
});

type GlabSetupInput = Static<typeof glabSetupSchema>;
type GlabIssueListInput = Static<typeof glabIssueListSchema>;
type GlabIssueViewInput = Static<typeof glabIssueViewSchema>;
type GlabSearchInput = Static<typeof glabSearchSchema>;

interface GlabToolDetails {
	items?: GlabIssue[];
	issue?: GlabIssue;
	projects?: GlabProject[];
	total?: number;
	project?: string;
	query?: string;
}

function textResult(text: string, details?: GlabToolDetails): AgentToolResult<GlabToolDetails> {
	return { content: [{ type: "text", text }], details };
}

// ─── GlabSetupTool ───────────────────────────────────────────────────────

export class GlabSetupTool implements AgentTool<typeof glabSetupSchema, GlabToolDetails> {
	readonly name = "glab_setup";
	readonly label = "GitLab Setup";
	readonly description = prompt.render(glabSetupDescription);
	readonly parameters = glabSetupSchema;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GlabSetupTool | null {
		if (!git.gitlab.available()) return null;
		return new GlabSetupTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GlabSetupInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GlabToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GlabToolDetails>> {
		const api = makeExecApi(this.session.cwd);

		switch (params.action) {
			case "check": {
				const installed = await checkInstalled(api);
				if (!installed) {
					return textResult(
						'glab is not installed.\n\nInstall it with:\n- **macOS**: `brew install glab`\n- **Linux**: Download from https://gitlab.com/gitlab-org/cli/-/releases\n- **Windows**: `winget install gitlab.glab`\n\nAfter installing, call glab_setup with action "login" to authenticate.',
					);
				}
				const ver = await api.exec("glab", ["--version"], { signal });
				return textResult(`glab is installed: ${ver.stdout.trim()}`);
			}

			case "status": {
				const authResult = await api.exec("glab", ["auth", "status"], { signal });
				const config = await loadConfig(this.session.cwd);
				const projectInfo = config?.project
					? `\nConfigured project: ${config.project}`
					: "\nNo project configured. Run select_project to choose one.";
				const authStatus = authResult.code === 0 ? authResult.stdout : `Not authenticated: ${authResult.stderr}`;
				return textResult(authStatus + projectInfo);
			}

			case "login":
				return textResult(
					"Starting GitLab authentication...\n\nRunning: `glab auth login --hostname gitlab.com --git-protocol https --web`\n\nYour browser will open for you to authorize access. Return here after authorizing.",
				);

			case "select_project": {
				const authenticated = await checkAuth(api);
				if (!authenticated) {
					return textResult('Not authenticated. Run glab_setup with action "login" first.');
				}
				const projects = await execGlabJson<GlabProject[]>(
					api,
					["repo", "list", "--member", "--output", "json", "--per-page", "50"],
					signal,
				);
				if (!projects.length) {
					return textResult("No projects found for your account.");
				}
				const list = projects
					.map((p, i) => `${i + 1}. **${p.name_with_namespace}** — \`${p.path_with_namespace}\``)
					.join("\n");
				return textResult(
					`Found ${projects.length} projects:\n\n${list}\n\nWhich project do you want to use for GitLab issue tracking? Reply with the number or full path.`,
					{ projects },
				);
			}

			case "save_project": {
				if (!params.project) {
					return textResult("Error: project parameter is required for save_project action.");
				}
				const existing = (await loadConfig(this.session.cwd)) ?? {
					project: "",
					hostname: "gitlab.com",
					defaultState: "opened" as const,
					perPage: 30,
				};
				await saveConfig(this.session.cwd, { ...existing, project: params.project });
				return textResult(`Configuration saved. Default project set to: **${params.project}**`);
			}

			default:
				return textResult(`Unknown action: ${params.action}`);
		}
	}
}

// ─── GlabIssueListTool ──────────────────────────────────────────────────

export class GlabIssueListTool implements AgentTool<typeof glabIssueListSchema, GlabToolDetails> {
	readonly name = "glab_issue_list";
	readonly label = "GitLab Issues";
	readonly description = prompt.render(glabIssueListDescription);
	readonly parameters = glabIssueListSchema;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GlabIssueListTool | null {
		if (!git.gitlab.available()) return null;
		return new GlabIssueListTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GlabIssueListInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GlabToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GlabToolDetails>> {
		const api = makeExecApi(this.session.cwd);
		const project = await resolveProject(params.project, this.session.cwd, (cmd, args) => api.exec(cmd, args));
		if (!project) {
			return textResult("No GitLab project configured. Run glab_setup to set one up.");
		}

		const args = ["issue", "list", "--output", "json", "--repo", project];
		if (params.state === "closed") args.push("--closed");
		else if (params.state === "all") args.push("--all");
		if (params.labels?.length) args.push("--label", params.labels.join(","));
		if (params.assignee) args.push("--assignee", params.assignee);
		if (params.search) args.push("--search", params.search);
		if (params.milestone) args.push("--milestone", params.milestone);
		if (params.sort) args.push("--order", params.sort);
		if (params.order) args.push("--sort", params.order);
		args.push("--per-page", String(Math.min(params.limit ?? 30, 100)));

		try {
			const issues = await execGlabJson<GlabIssue[]>(api, args, signal);
			return textResult(formatIssueTable(issues), { items: issues, total: issues.length, project });
		} catch (err) {
			if (err instanceof GlabAuthError) return textResult((err as Error).message);
			throw err;
		}
	}
}

// ─── GlabIssueViewTool ──────────────────────────────────────────────────

export class GlabIssueViewTool implements AgentTool<typeof glabIssueViewSchema, GlabToolDetails> {
	readonly name = "glab_issue_view";
	readonly label = "GitLab Issue";
	readonly description = prompt.render(glabIssueViewDescription);
	readonly parameters = glabIssueViewSchema;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GlabIssueViewTool | null {
		if (!git.gitlab.available()) return null;
		return new GlabIssueViewTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GlabIssueViewInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GlabToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GlabToolDetails>> {
		const api = makeExecApi(this.session.cwd);
		const project = await resolveProject(params.project, this.session.cwd, (cmd, args) => api.exec(cmd, args));
		if (!project) {
			return textResult("No GitLab project configured. Run glab_setup to set one up.");
		}

		const issueId = String(params.issue);
		const args = ["issue", "view", issueId, "--output", "json", "--repo", project];
		if (params.comments !== false) args.push("--comments");

		try {
			const issue = await execGlabJson<GlabIssue>(api, args, signal);
			return textResult(formatIssueDetail(issue), { issue, project });
		} catch (err) {
			if (err instanceof GlabAuthError) return textResult((err as Error).message);
			throw err;
		}
	}
}

// ─── GlabSearchTool ─────────────────────────────────────────────────────

export class GlabSearchTool implements AgentTool<typeof glabSearchSchema, GlabToolDetails> {
	readonly name = "glab_search";
	readonly label = "GitLab Search";
	readonly description = prompt.render(glabSearchDescription);
	readonly parameters = glabSearchSchema;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GlabSearchTool | null {
		if (!git.gitlab.available()) return null;
		return new GlabSearchTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GlabSearchInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GlabToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GlabToolDetails>> {
		const api = makeExecApi(this.session.cwd);
		const project = await resolveProject(params.project, this.session.cwd, (cmd, args) => api.exec(cmd, args));
		if (!project) {
			return textResult("No GitLab project configured. Run glab_setup to set one up.");
		}

		const limit = Math.min(params.limit ?? 20, 100);
		let issues: GlabIssue[] = [];

		const restArgs = [
			"issue",
			"list",
			"--output",
			"json",
			"--repo",
			project,
			"--search",
			params.query,
			"--per-page",
			String(limit),
		];
		if (params.state === "closed") restArgs.push("--closed");
		else if (params.state === "all") restArgs.push("--all");
		if (params.labels?.length) restArgs.push("--label", params.labels.join(","));

		try {
			issues = await execGlabJson<GlabIssue[]>(api, restArgs, signal);
		} catch (err) {
			if (err instanceof GlabAuthError) return textResult((err as Error).message);
		}

		let graphqlNodes: GraphQLIssueNode[] = [];
		try {
			graphqlNodes = await executeGraphQL(api, project, params.query, limit, signal, params.state);
		} catch {
			// GraphQL unavailable — use REST results only
		}

		if (graphqlNodes.length > 0) {
			const seenIids = new Set(issues.map(i => i.iid));
			for (const node of graphqlNodes) {
				const iid = parseInt(node.iid, 10);
				if (seenIids.has(iid)) continue;
				seenIids.add(iid);
				const lowerQuery = params.query.toLowerCase();
				const inTitle = node.title.toLowerCase().includes(lowerQuery);
				const inComments = node.notes.nodes.some(n => n.body.toLowerCase().includes(lowerQuery));
				if (inTitle || inComments) {
					issues.push({
						id: iid,
						iid,
						title: node.title,
						description: "",
						state: node.state === "OPEN" ? "opened" : "closed",
						labels: node.labels.nodes.map(l => l.title),
						assignees: node.assignees.nodes.map(a => ({ username: a.username, name: a.username })),
						author: { username: "", name: "" },
						milestone: null,
						created_at: node.updatedAt,
						updated_at: node.updatedAt,
						web_url: `https://gitlab.com/${project}/-/issues/${iid}`,
						references: { full: `${project}#${iid}` },
						issue_type: "issue",
					});
				}
			}
		}

		return textResult(formatIssueTable(issues), {
			items: issues,
			total: issues.length,
			project,
			query: params.query,
		});
	}
}
