import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { validateToolArguments } from "@f5-sales-demo/pi-ai";
import type { CustomToolContext } from "../../src/extensibility/custom-tools/types";
import type { ToolSession } from "../../src/tools";
import { runSearchQuery, SearchTool, type SearchToolParams, webSearchCustomTool } from "../../src/web/search";
import { normalizeUserLocation } from "../../src/web/search/params";
import { getSearchProvider, SEARCH_PROVIDER_ORDER, setPreferredSearchProvider } from "../../src/web/search/provider";

const source = { title: "Example", url: "https://example.com", snippet: "Search result" };
const tool = new SearchTool({} as ToolSession);

beforeEach(() => {
	for (const id of SEARCH_PROVIDER_ORDER) {
		const provider = getSearchProvider(id);
		vi.spyOn(provider, "isAvailable").mockReturnValue(id === "anthropic" || id === "brave");
		vi.spyOn(provider, "search").mockResolvedValue({ provider: id, sources: [source], answer: "Search result" });
	}
	setPreferredSearchProvider("brave");
});

afterEach(() => {
	vi.restoreAllMocks();
	setPreferredSearchProvider("auto");
});

const fixtures = [
	[
		{ type: "approximate", city: "", region: "", country: "GB", timezone: "Europe/London" },
		{ type: "approximate", country: "GB", timezone: "Europe/London" },
	],
	[
		{ type: "approximate", city: " \t", region: "\n", country: " gb ", timezone: " Europe/London " },
		{ type: "approximate", country: "GB", timezone: "Europe/London" },
	],
	[
		{ type: "approximate", city: null, region: null, country: "gb", timezone: null },
		{ type: "approximate", country: "GB" },
	],
	[undefined, undefined],
	[null, undefined],
	[{ type: "approximate" }, undefined],
	[{ type: "approximate", city: "", region: null, country: " \t", timezone: "\n" }, undefined],
	[
		{ type: "approximate", city: " London " },
		{ type: "approximate", city: "London" },
	],
	[
		{ type: "approximate", city: "London", region: "London", country: "GB", timezone: "Europe/London" },
		{ type: "approximate", city: "London", region: "London", country: "GB", timezone: "Europe/London" },
	],
] as const;

for (const entry of ["programmatic", "agent", "custom"] as const) {
	describe(`optional location dispatch: ${entry}`, () => {
		it.each(fixtures)("normalizes %j to %j", async (location, expected) => {
			const params = { query: "public documentation", user_location: location } as SearchToolParams;
			const snapshot = structuredClone(params);
			const validated =
				entry === "programmatic"
					? params
					: (validateToolArguments(tool, {
							type: "toolCall",
							id: "location-test",
							name: tool.name,
							arguments: params,
						}) as SearchToolParams);
			const result =
				entry === "programmatic"
					? await runSearchQuery(validated)
					: entry === "agent"
						? await tool.execute("location-test", validated)
						: await webSearchCustomTool.execute("location-test", validated, undefined, {} as CustomToolContext);
			expect(result.details?.error).toBeUndefined();
			expect(result.details?.response.sources).toEqual([source]);
			const provider = expected ? "anthropic" : "brave";
			expect(result.details?.response.provider).toBe(provider);
			expect(getSearchProvider(provider).search).toHaveBeenCalledTimes(1);
			expect(getSearchProvider(provider).search).toHaveBeenCalledWith(
				expect.objectContaining({ userLocation: expected }),
			);
			expect(getSearchProvider(expected ? "brave" : "anthropic").search).not.toHaveBeenCalled();
			expect(params).toEqual(snapshot);
		});
	});
}

describe("invalid nonempty location inputs", () => {
	it.each(
		[
			{ type: "precise" },
			{ type: null },
			{},
			"invalid",
			42,
			[],
			{ type: "approximate", city: 1 },
			{ type: "approximate", region: false },
			{ type: "approximate", timezone: [] },
			{ type: "approximate", country: 12 },
			{ type: "approximate", country: " GBR " },
			{ type: "approximate", country: "1A" },
		].map(location => [location]),
	)("preserves validation failure without throwing for %j", async location => {
		const params = { query: "test", user_location: location } as SearchToolParams;
		const snapshot = structuredClone(params);
		expect(() => normalizeUserLocation(params.user_location)).not.toThrow();
		const result = await runSearchQuery(params);
		expect(result.details.error).toContain("web_search invalid parameter:");
		for (const id of SEARCH_PROVIDER_ORDER) expect(getSearchProvider(id).search).not.toHaveBeenCalled();
		expect(params).toEqual(snapshot);
	});

	it("still rejects an empty query after location normalization", async () => {
		const result = await runSearchQuery({ query: " ", user_location: { type: "approximate", city: "" } });
		expect(result.details.error).toBe("web_search invalid parameter: query must be a non-empty string");
		expect(getSearchProvider("brave").search).not.toHaveBeenCalled();
	});

	it("keeps other Anthropic-only routing when location is empty", async () => {
		const result = await runSearchQuery({
			query: "test",
			user_location: { type: "approximate" },
			allowed_domains: ["example.com"],
		});
		expect(result.details.response.provider).toBe("anthropic");
	});

	it("respects an explicitly selected provider with usable location", async () => {
		const result = await runSearchQuery({
			query: "test",
			provider: "brave",
			user_location: { type: "approximate", country: "gb" },
		});
		expect(result.details.response.provider).toBe("brave");
	});
});
