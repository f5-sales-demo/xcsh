import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh"
import { GlabAuthError, checkAuth, checkInstalled, execGlabJson } from "./lib/exec"
import { formatIssueDetail, formatIssueTable } from "./lib/formatters"
import { executeGraphQL } from "./lib/graphql"
import { loadConfig, resolveProject, saveConfig } from "./lib/config"
import type { GlabIssue, GlabProject, GraphQLIssueNode } from "./lib/types"

const factory: CustomToolFactory = pi => {
	const { Type } = pi.typebox
	const { StringEnum } = pi.pi

	const SetupParams = Type.Object({
		action: StringEnum(["check", "login", "select_project", "save_project", "status"] as const),
		project: Type.Optional(Type.String({ description: "Project path to persist (used with save_project)" })),
	})

	const glabSetup = {
		name: "glab_setup" as const,
		label: "GitLab Setup",
		description:
			"GitLab onboarding wizard: check glab installation, authenticate, discover projects, and persist configuration. Run this first if the user has not set up GitLab yet.",
		parameters: SetupParams,

		async execute(
			_toolCallId: string,
			params: { action: string; project?: string },
			_onUpdate: unknown,
			_ctx: unknown,
			signal?: AbortSignal,
		) {
			switch (params.action) {
				case "check": {
					const installed = await checkInstalled(pi)
					if (!installed) {
						return {
							content: [
								{
									type: "text" as const,
									text: "glab is not installed.\n\nInstall it with:\n- **macOS**: `brew install glab`\n- **Linux**: Download from https://gitlab.com/gitlab-org/cli/-/releases\n- **Windows**: `winget install gitlab.glab`\n\nAfter installing, call glab_setup with action \"login\" to authenticate.",
								},
							],
						}
					}
					const verResult = await pi.exec("glab", ["--version"], { signal, cwd: pi.cwd })
					return {
						content: [{ type: "text" as const, text: `glab is installed: ${verResult.stdout.trim()}` }],
					}
				}

				case "status": {
					const authResult = await pi.exec("glab", ["auth", "status"], { signal, cwd: pi.cwd })
					const config = await loadConfig(pi.cwd)
					const projectInfo = config?.project
						? `\nConfigured project: ${config.project}`
						: "\nNo project configured. Run select_project to choose one."
					const authStatus = authResult.code === 0 ? authResult.stdout : `Not authenticated: ${authResult.stderr}`
					return {
						content: [{ type: "text" as const, text: authStatus + projectInfo }],
					}
				}

				case "login": {
					return {
						content: [
							{
								type: "text" as const,
								text: "Starting GitLab authentication...\n\nRunning: `glab auth login --hostname gitlab.com --git-protocol https --web`\n\nYour browser will open for you to authorize access. Return here after authorizing.",
							},
						],
					}
				}

				case "select_project": {
					const authenticated = await checkAuth(pi)
					if (!authenticated) {
						return {
							content: [{ type: "text" as const, text: 'Not authenticated. Run glab_setup with action "login" first.' }],
						}
					}
					const projects = await execGlabJson<GlabProject[]>(
						pi,
						["repo", "list", "--member", "--output", "json", "--per-page", "50"],
						signal,
					)
					if (!projects.length) {
						return {
							content: [{ type: "text" as const, text: "No projects found for your account." }],
						}
					}
					const list = projects
						.map((p, i) => `${i + 1}. **${p.name_with_namespace}** — \`${p.path_with_namespace}\``)
						.join("\n")
					return {
						content: [
							{
								type: "text" as const,
								text: `Found ${projects.length} projects:\n\n${list}\n\nWhich project do you want to use for GitLab issue tracking? Reply with the number or full path.`,
							},
						],
						details: { projects },
					}
				}

				case "save_project": {
					if (!params.project) {
						return {
							content: [
								{ type: "text" as const, text: "Error: project parameter is required for save_project action." },
							],
						}
					}
					const existing = (await loadConfig(pi.cwd)) ?? {
						project: "",
						hostname: "gitlab.com",
						defaultState: "opened" as const,
						perPage: 30,
					}
					await saveConfig(pi.cwd, { ...existing, project: params.project })
					return {
						content: [
							{
								type: "text" as const,
								text: `Configuration saved. Default project set to: **${params.project}**`,
							},
						],
					}
				}

				default:
					return { content: [{ type: "text" as const, text: `Unknown action: ${params.action}` }] }
			}
		},
	}

	const IssueListParams = Type.Object({
		project: Type.Optional(
			Type.String({ description: "GitLab project path (e.g. group/repo). Defaults to configured project." }),
		),
		state: Type.Optional(StringEnum(["opened", "closed", "all"] as const)),
		labels: Type.Optional(
			Type.Array(Type.String(), { description: "Filter by labels (e.g. ['bug', 'priority::high'])" }),
		),
		assignee: Type.Optional(Type.String({ description: "Filter by assignee username" })),
		search: Type.Optional(Type.String({ description: "Search text in title and description" })),
		milestone: Type.Optional(Type.String()),
		sort: Type.Optional(StringEnum(["created_at", "updated_at", "priority", "due_date"] as const)),
		order: Type.Optional(StringEnum(["asc", "desc"] as const)),
		limit: Type.Optional(Type.Number({ default: 30, maximum: 100 })),
	})

	const glabIssueList = {
		name: "glab_issue_list" as const,
		label: "GitLab Issue List",
		description:
			"List GitLab issues with structured filters. Use for 'show open bugs', 'list issues assigned to X', 'show high priority issues'. Returns a summary table.",
		parameters: IssueListParams,

		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			_onUpdate: unknown,
			_ctx: unknown,
			signal?: AbortSignal,
		) {
			const project = await resolveProject(params.project as string | undefined, pi.cwd)
			if (!project) {
				return {
					content: [
						{ type: "text" as const, text: "No GitLab project configured. Run glab_setup to set one up." },
					],
				}
			}

			const args = ["issue", "list", "--output", "json", "--repo", project]
			const state = params.state as string | undefined
			if (state === "opened") args.push("--opened")
			else if (state === "closed") args.push("--closed")
			else if (state === "all") args.push("--all")
			if (params.labels && Array.isArray(params.labels) && params.labels.length > 0)
				args.push("--label", (params.labels as string[]).join(","))
			if (params.assignee) args.push("--assignee", params.assignee as string)
			if (params.search) args.push("--search", params.search as string)
			if (params.milestone) args.push("--milestone", params.milestone as string)
			if (params.sort) args.push("--order", params.sort as string)
			if (params.order) args.push("--sort", params.order as string)
			args.push("--per-page", String(Math.min(Number(params.limit ?? 30), 100)))

			try {
				const issues = await execGlabJson<GlabIssue[]>(pi, args, signal)
				return {
					content: [{ type: "text" as const, text: formatIssueTable(issues) }],
					details: { items: issues, total: issues.length, project },
				}
			} catch (err) {
				if (err instanceof GlabAuthError) {
					return { content: [{ type: "text" as const, text: (err as Error).message }] }
				}
				throw err
			}
		},
	}

	const IssueViewParams = Type.Object({
		issue: Type.Union([Type.Number(), Type.String()], { description: "Issue IID number or full URL" }),
		project: Type.Optional(Type.String()),
		comments: Type.Optional(Type.Boolean({ default: true })),
	})

	const glabIssueView = {
		name: "glab_issue_view" as const,
		label: "GitLab Issue View",
		description:
			"View a single GitLab issue with full details, description, and comments. Use when the user asks to 'show issue #N' or 'view details of issue X'.",
		parameters: IssueViewParams,

		async execute(
			_toolCallId: string,
			params: { issue: number | string; project?: string; comments?: boolean },
			_onUpdate: unknown,
			_ctx: unknown,
			signal?: AbortSignal,
		) {
			const project = await resolveProject(params.project, pi.cwd)
			if (!project) {
				return {
					content: [
						{ type: "text" as const, text: "No GitLab project configured. Run glab_setup to set one up." },
					],
				}
			}

			const issueId = String(params.issue)
			const args = ["issue", "view", issueId, "--output", "json", "--repo", project]
			if (params.comments !== false) args.push("--comments")

			try {
				const issue = await execGlabJson<GlabIssue>(pi, args, signal)
				return {
					content: [{ type: "text" as const, text: formatIssueDetail(issue) }],
					details: { issue, project },
				}
			} catch (err) {
				if (err instanceof GlabAuthError) {
					return { content: [{ type: "text" as const, text: (err as Error).message }] }
				}
				throw err
			}
		},
	}

	const SearchParams = Type.Object({
		query: Type.String({
			description: "Search text to find across issue titles, descriptions, labels, and comments",
		}),
		project: Type.Optional(Type.String()),
		state: Type.Optional(StringEnum(["opened", "closed", "all"] as const)),
		labels: Type.Optional(Type.Array(Type.String())),
		limit: Type.Optional(Type.Number({ default: 20, maximum: 100 })),
	})

	const glabSearch = {
		name: "glab_search" as const,
		label: "GitLab Search",
		description:
			"Full-text search across GitLab issue titles, descriptions, labels, and comments. Use for queries like 'find issues about Tempus' or 'search for login timeout bugs'. Searches comments too.",
		parameters: SearchParams,

		async execute(
			_toolCallId: string,
			params: { query: string; project?: string; state?: string; labels?: string[]; limit?: number },
			_onUpdate: unknown,
			_ctx: unknown,
			signal?: AbortSignal,
		) {
			const project = await resolveProject(params.project, pi.cwd)
			if (!project) {
				return {
					content: [
						{ type: "text" as const, text: "No GitLab project configured. Run glab_setup to set one up." },
					],
				}
			}

			const limit = Math.min(params.limit ?? 20, 100)
			let issues: GlabIssue[] = []

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
			]
			if (params.state === "opened") restArgs.push("--opened")
			else if (params.state === "closed") restArgs.push("--closed")
			else if (params.state === "all") restArgs.push("--all")
			if (params.labels?.length) restArgs.push("--label", params.labels.join(","))

			try {
				issues = await execGlabJson<GlabIssue[]>(pi, restArgs, signal)
			} catch (err) {
				if (err instanceof GlabAuthError) {
					return { content: [{ type: "text" as const, text: (err as Error).message }] }
				}
			}

			let graphqlNodes: GraphQLIssueNode[] = []
			try {
				graphqlNodes = await executeGraphQL(pi, project, params.query, limit, signal, params.state)
			} catch {
				// GraphQL unavailable — use REST results only
			}

			if (graphqlNodes.length > 0) {
				const seenIids = new Set(issues.map(i => i.iid))
				for (const node of graphqlNodes) {
					const iid = parseInt(node.iid, 10)
					if (seenIids.has(iid)) continue
					seenIids.add(iid)
					const lowerQuery = params.query.toLowerCase()
					const inTitle = node.title.toLowerCase().includes(lowerQuery)
					const inComments = node.notes.nodes.some(n => n.body.toLowerCase().includes(lowerQuery))
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
						})
					}
				}
			}

			return {
				content: [{ type: "text" as const, text: formatIssueTable(issues) }],
				details: { items: issues, total: issues.length, project, query: params.query },
			}
		},
	}

	return [glabSetup, glabIssueList, glabIssueView, glabSearch]
}

export default factory
