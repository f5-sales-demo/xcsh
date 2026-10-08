import { afterEach, expect, test, vi } from "bun:test";
import { runSearchQuery, SearchTool } from "../../src/web/search/index";
import { getSearchProvider, SEARCH_PROVIDER_ORDER } from "../../src/web/search/provider";

afterEach(() => vi.restoreAllMocks());

function providers(enabled: boolean) {
	for (const id of SEARCH_PROVIDER_ORDER) {
		vi.spyOn(getSearchProvider(id), "isAvailable").mockImplementation(() => enabled && id === "synthetic");
	}
}

test("invalid parameters and missing providers are explicit errors", async () => {
	providers(false);
	for (const query of [" ", "synthetic fixture query"]) {
		const result = await runSearchQuery({ query });
		expect(result.isError).toBe(true);
		expect(result.details.error).toBeTruthy();
	}
});

test("exhausted providers are errors while a valid zero-result search succeeds", async () => {
	providers(true);
	const search = vi.spyOn(getSearchProvider("synthetic"), "search");
	search.mockRejectedValueOnce(new Error("synthetic transport failure"));
	const failed = await runSearchQuery({ query: "fixture", provider: "synthetic" });
	expect(failed.isError).toBe(true);
	expect(failed.details.error).toContain("synthetic transport failure");
	search.mockResolvedValueOnce({ provider: "synthetic", sources: [] });
	const empty = await runSearchQuery({ query: "fixture", provider: "synthetic" });
	expect(empty.isError).not.toBe(true);
	expect(empty.details.response.sources).toEqual([]);
	expect(empty.details.error).toBeUndefined();
});

test("search cancellation remains cancellation without provider fallback", async () => {
	providers(true);
	const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
	vi.spyOn(getSearchProvider("synthetic"), "search").mockRejectedValueOnce(abort);
	await expect(new SearchTool({} as never).execute("fixture", { query: "fixture" })).rejects.toBe(abort);
});
