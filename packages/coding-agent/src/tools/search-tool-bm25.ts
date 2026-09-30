import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { type Component, Text } from "@f5-sales-demo/pi-tui";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import searchToolBm25ProgressiveDescription from "../prompts/tools/search-tool-bm25-progressive.md" with {
	type: "text",
};
import { renderStatusLine, renderTreeList, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import {
	buildDiscoverableToolSearchIndex,
	type DiscoverableTool,
	type DiscoverableToolSearchIndex,
	searchDiscoverableTools,
} from "./discoverable-tool-metadata";
import { formatCount, replaceTabs } from "./render-utils";
import { ToolError } from "./tool-errors";

const DEFAULT_LIMIT = 8;
const TOOL_DISCOVERY_TITLE = "Tool Discovery";
const COLLAPSED_MATCH_LIMIT = 5;
const MATCH_LABEL_LEN = 72;
const MATCH_DESCRIPTION_LEN = 96;

const searchToolBm25Schema = Type.Object({
	query: Type.String({ description: "Search query for deferred tool metadata" }),
	limit: Type.Optional(
		Type.Integer({ description: "Max matching tools to activate and return (default 8)", minimum: 1 }),
	),
});

type SearchToolBm25Params = Static<typeof searchToolBm25Schema>;

interface SearchToolBm25Match {
	name: string;
	label: string;
	description: string;
	schema_keys: string[];
	score: number;
}

export interface SearchToolBm25Details {
	query: string;
	limit: number;
	total_tools: number;
	activated_tools: string[];
	active_selected_tools: string[];
	tools: SearchToolBm25Match[];
}

function formatMatch(tool: DiscoverableTool, score: number): SearchToolBm25Match {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		schema_keys: tool.schemaKeys,
		score: Number(score.toFixed(6)),
	};
}

function buildSearchToolBm25Content(details: SearchToolBm25Details): string {
	return JSON.stringify({
		query: details.query,
		activated_tools: details.activated_tools,
		match_count: details.tools.length,
		total_tools: details.total_tools,
	});
}

function getDiscoverableToolsForDescription(session: ToolSession): DiscoverableTool[] {
	try {
		return session.getDiscoverableTools?.() ?? [];
	} catch {
		return [];
	}
}

function getDiscoverableToolSearchIndexForExecution(session: ToolSession): DiscoverableToolSearchIndex {
	try {
		const cached = session.getDiscoverableToolSearchIndex?.();
		if (cached) return cached;
	} catch {}
	return buildDiscoverableToolSearchIndex(session.getDiscoverableTools?.() ?? []);
}

type ToolDiscoveryExecutionSession = ToolSession & {
	getActiveTools?: () => string[];
	activateDiscoveredTools?: (toolNames: string[]) => Promise<string[]>;
};

function supportsToolDiscoveryExecution(session: ToolSession): session is ToolDiscoveryExecutionSession {
	return typeof session.getActiveTools === "function" && typeof session.activateDiscoveredTools === "function";
}

export function renderSearchToolBm25Description(discoverableTools: DiscoverableTool[] = []): string {
	return prompt.render(searchToolBm25ProgressiveDescription, { discoverableToolCount: discoverableTools.length });
}

function renderMatchLines(match: SearchToolBm25Match, theme: Theme): string[] {
	const safeLabel = replaceTabs(match.label);
	const safeDescription = replaceTabs(match.description.trim());
	const metaParts: string[] = [];
	metaParts.push(theme.fg("dim", `score ${match.score.toFixed(3)}`));
	const metaSep = theme.fg("dim", theme.sep.dot);
	const metaSuffix = metaParts.length > 0 ? ` ${metaParts.join(metaSep)}` : "";
	const lines = [`${theme.fg("contentAccent", truncateToWidth(safeLabel, MATCH_LABEL_LEN))}${metaSuffix}`];
	if (safeDescription) {
		lines.push(theme.fg("muted", truncateToWidth(safeDescription, MATCH_DESCRIPTION_LEN)));
	}
	return lines;
}

function renderFallbackResult(text: string, theme: Theme): Component {
	const header = renderStatusLine({ title: TOOL_DISCOVERY_TITLE }, theme);
	return {
		render(width: number): string[] {
			const bodyLines = (text || "Tool discovery completed")
				.split("\n")
				.map(line => theme.fg("dim", truncateToWidth(replaceTabs(line), width)));
			return [header, ...bodyLines];
		},
		invalidate() {},
	};
}

export class SearchToolBm25Tool implements AgentTool<typeof searchToolBm25Schema, SearchToolBm25Details> {
	readonly name = "search_tool_bm25";
	readonly label = "SearchToolBm25";
	get description(): string {
		return renderSearchToolBm25Description(getDiscoverableToolsForDescription(this.session));
	}
	readonly parameters = searchToolBm25Schema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): SearchToolBm25Tool | null {
		if (session.settings.get("context.loadingMode") !== "progressive") return null;
		return supportsToolDiscoveryExecution(session) ? new SearchToolBm25Tool(session) : null;
	}

	async execute(
		_toolCallId: string,
		params: SearchToolBm25Params,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SearchToolBm25Details>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SearchToolBm25Details>> {
		if (!supportsToolDiscoveryExecution(this.session)) {
			throw new ToolError("Tool discovery is unavailable in this session.");
		}
		const query = params.query.trim();
		if (query.length === 0) {
			throw new ToolError("Query is required and must not be empty.");
		}
		const limit = params.limit ?? DEFAULT_LIMIT;
		if (!Number.isInteger(limit) || limit <= 0) {
			throw new ToolError("Limit must be a positive integer.");
		}

		const searchIndex = getDiscoverableToolSearchIndexForExecution(this.session);
		const selectedToolNames = new Set(this.session.getActiveTools?.() ?? []);
		let ranked: Array<{ tool: DiscoverableTool; score: number }> = [];
		try {
			ranked = searchDiscoverableTools(searchIndex, query, searchIndex.documents.length)
				.filter(result => !selectedToolNames.has(result.tool.name))
				.slice(0, limit);
		} catch (error) {
			if (error instanceof Error) {
				throw new ToolError(error.message);
			}
			throw error;
		}
		const activated =
			ranked.length === 0 ? [] : await this.session.activateDiscoveredTools!(ranked.map(result => result.tool.name));

		const details: SearchToolBm25Details = {
			query,
			limit,
			total_tools: searchIndex.documents.length,
			activated_tools: activated,
			active_selected_tools: this.session.getActiveTools?.() ?? [],
			tools: ranked.map(result => formatMatch(result.tool, result.score)),
		};

		return {
			content: [{ type: "text", text: buildSearchToolBm25Content(details) }],
			tools: activated.flatMap(name => {
				const tool = this.session.getToolDefinition?.(name);
				return tool
					? [
							{
								name: tool.name,
								description: tool.description,
								parameters: tool.parameters,
								strict: tool.strict,
								constrainedSampling: tool.constrainedSampling,
							},
						]
					: [];
			}),
			details,
			...(ranked.length === 0 ? { isWarning: true } : {}),
		};
	}
}

export const searchToolBm25Renderer = {
	renderCall(args: SearchToolBm25Params, _options: RenderResultOptions, uiTheme: Theme): Component {
		const query = typeof args.query === "string" ? replaceTabs(args.query.trim()) : "";
		const meta = args.limit ? [`limit:${args.limit}`] : [];
		return new Text(
			renderStatusLine(
				{ icon: "pending", title: TOOL_DISCOVERY_TITLE, description: query || "(empty query)", meta },
				uiTheme,
			),
			0,
			0,
		);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: SearchToolBm25Details; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		if (!result.details) {
			const fallbackText = result.content
				.filter(part => part.type === "text")
				.map(part => part.text)
				.filter((text): text is string => typeof text === "string" && text.length > 0)
				.join("\n");
			return renderFallbackResult(fallbackText, uiTheme);
		}

		const { details } = result;
		const meta = [
			formatCount("match", details.tools.length),
			`${details.active_selected_tools.length} active`,
			`${details.total_tools} total`,
			`limit:${details.limit}`,
		];
		const safeQuery = replaceTabs(details.query);
		const header = renderStatusLine(
			{
				title: TOOL_DISCOVERY_TITLE,
				description: truncateToWidth(safeQuery, MATCH_LABEL_LEN),
				meta,
			},
			uiTheme,
		);
		if (details.tools.length === 0) {
			const emptyMessage =
				details.total_tools === 0 ? "No discoverable tools are currently loaded." : "No matching tools found.";
			return new Text(`${header}\n${uiTheme.fg("muted", emptyMessage)}`, 0, 0);
		}

		return {
			render(width) {
				const treeLines = renderTreeList(
					{
						items: details.tools,
						viewportWidth: width,
						expanded: options.expanded,
						maxCollapsed: COLLAPSED_MATCH_LIMIT,
						itemType: "tool",
						renderItem: match => renderMatchLines(match, uiTheme),
					},
					uiTheme,
				);
				return [header, ...treeLines];
			},
			invalidate() {},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
