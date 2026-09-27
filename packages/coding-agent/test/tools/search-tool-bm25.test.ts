import { describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import {
	buildDiscoverableToolSearchIndex,
	type DiscoverableTool,
	searchDiscoverableTools,
} from "../../src/tools/discoverable-tool-metadata";
import type { ToolSession } from "../../src/tools/index";
import { renderSearchToolBm25Description, SearchToolBm25Tool } from "../../src/tools/search-tool-bm25";

type DiscoverySession = ToolSession & { getSelected(): string[] };

const discoverableTools: DiscoverableTool[] = [
	{
		name: "github_create_issue",
		label: "GitHub create issue",
		description: "Create a GitHub issue in the selected repository",
		schemaKeys: ["owner", "repo", "title", "body"],
	},
	{
		name: "github_list_pull_requests",
		label: "GitHub list pull requests",
		description: "List pull requests for a repository",
		schemaKeys: ["owner", "repo", "state"],
	},
	{
		name: "slack_post_message",
		label: "Slack post message",
		description: "Post a message to a Slack channel",
		schemaKeys: ["channel", "text"],
	},
];

function createSession(
	tools: DiscoverableTool[] = discoverableTools,
	loadingMode: "eager" | "progressive" = "progressive",
): DiscoverySession {
	const selected: string[] = [];
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "context.loadingMode": loadingMode }),
		getDiscoverableTools: () => tools,
		getDiscoverableToolSearchIndex: () => buildDiscoverableToolSearchIndex(tools),
		getActiveTools: () => [...selected],
		activateDiscoveredTools: async names => {
			for (const name of names) {
				if (!selected.includes(name)) selected.push(name);
			}
			return names;
		},
		getSelected: () => [...selected],
	} as DiscoverySession;
}

describe("generic progressive tool discovery", () => {
	it("builds deterministic BM25 metadata without source-specific fields", () => {
		const index = buildDiscoverableToolSearchIndex(discoverableTools);
		expect(searchDiscoverableTools(index, "github issue", 2).map(result => result.tool.name)).toEqual([
			"github_create_issue",
			"github_list_pull_requests",
		]);
		expect(Object.keys(discoverableTools[0]!).sort()).toEqual(["description", "label", "name", "schemaKeys"]);
	});

	it("advertises only generic deferred tool metadata", () => {
		const description = renderSearchToolBm25Description(discoverableTools);
		expect(description).toContain("Total discoverable tools loaded: 3.");
		expect(description).toContain("schema_keys");
		expect(description).toContain("activated_tools");
		expect(description).not.toContain("server");
	});

	it("is available only for progressive sessions with activation support", () => {
		expect(SearchToolBm25Tool.createIf(createSession())).toBeInstanceOf(SearchToolBm25Tool);
		expect(SearchToolBm25Tool.createIf(createSession(discoverableTools, "eager"))).toBeNull();
	});

	it("activates ranked tools additively and skips already-active matches", async () => {
		const session = createSession();
		const tool = new SearchToolBm25Tool(session);
		const first = await tool.execute("call-1", { query: "github issue", limit: 1 });
		expect(first.details?.activated_tools).toEqual(["github_create_issue"]);
		expect(session.getSelected()).toEqual(["github_create_issue"]);
		const second = await tool.execute("call-2", { query: "github", limit: 1 });
		expect(second.details?.activated_tools).toEqual(["github_list_pull_requests"]);
		expect(second.details?.active_selected_tools).toEqual(["github_create_issue", "github_list_pull_requests"]);
	});

	it("fails closed for invalid queries and warns when no tool matches", async () => {
		const tool = new SearchToolBm25Tool(createSession());
		await expect(tool.execute("empty", { query: "   " })).rejects.toThrow("Query is required");
		await expect(tool.execute("limit", { query: "github", limit: 0 as never })).rejects.toThrow(
			"Limit must be a positive integer",
		);
		const missing = await tool.execute("missing", { query: "quantumflux" });
		expect(missing.details?.tools).toEqual([]);
		expect(missing.isWarning).toBe(true);
	});
});
