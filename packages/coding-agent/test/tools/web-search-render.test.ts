import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { getThemeByName } from "../../src/modes/theme/theme";
import { renderSearchCall, renderSearchResult, type SearchRenderDetails } from "../../src/web/search/render";
import type { SearchResponse } from "../../src/web/search/types";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

function makeSearchResponse(overrides?: Partial<SearchResponse>): SearchResponse {
	return {
		provider: "anthropic",
		answer: "Test answer text",
		sources: [
			{ title: "Source 1", url: "https://example.com/1" },
			{ title: "Source 2", url: "https://example.com/2" },
		],
		usage: { inputTokens: 100, outputTokens: 50, searchRequests: 1 },
		model: "claude-haiku-4-5",
		requestId: "msg_test",
		durationMs: 3200,
		...overrides,
	};
}

function makeResult(response: SearchResponse): {
	content: Array<{ type: string; text?: string }>;
	details: SearchRenderDetails;
} {
	return {
		content: [{ type: "text", text: response.answer ?? "" }],
		details: { response },
	};
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("web search render — compact mode (verbose=false)", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeEach(async () => {
		theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
	});

	describe("renderSearchCall", () => {
		it('outputs Web Search("query") format in compact mode', () => {
			const component = renderSearchCall(
				{ query: "FFIV stock price" },
				{ expanded: false, isPartial: false },
				theme!,
			);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain('Web Search("FFIV stock price")');
		});

		it("does not contain box border characters in compact mode", () => {
			const component = renderSearchCall({ query: "test query" }, { expanded: false, isPartial: false }, theme!);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).not.toContain("┌");
			expect(text).not.toContain("│");
			expect(text).not.toContain("└");
		});
	});

	describe("renderSearchResult", () => {
		it("outputs compact 'Did N search in Xs' format", () => {
			const response = makeSearchResponse({ durationMs: 3200 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain("Did 1 search in 3s");
		});

		it("uses ⎿ continuation character", () => {
			const response = makeSearchResponse();
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain("\u23BF");
		});

		it("pluralizes 'searches' when count > 1", () => {
			const response = makeSearchResponse({
				usage: { inputTokens: 100, outputTokens: 50, searchRequests: 3 },
				durationMs: 5000,
			});
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain("Did 3 searches in 5s");
		});

		it("formats sub-second durations in milliseconds", () => {
			const response = makeSearchResponse({ durationMs: 450 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain("Did 1 search in 450ms");
		});

		it("does not show sources, metadata, or bordered box in compact mode", () => {
			const response = makeSearchResponse();
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).not.toContain("Provider:");
			expect(text).not.toContain("Sources:");
			expect(text).not.toContain("example.com");
			expect(text).not.toContain("┌");
		});

		it("handles missing durationMs gracefully", () => {
			const response = makeSearchResponse({ durationMs: undefined });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain("Did 1 search");
			expect(text).not.toContain("in ");
		});

		it("includes Web Search call header in compact result (mergeCallAndResult)", () => {
			const response = makeSearchResponse({ durationMs: 4000 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!, {
				query: "FFIV stock price",
			});
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain('Web Search("FFIV stock price")');
			expect(text).toContain("Did 1 search in 4s");
		});

		it("uses searchQueries for header when args.query is absent", () => {
			const response = makeSearchResponse({
				durationMs: 2000,
				searchQueries: ["FFIV F5 stock price today"],
			});
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain('Web Search("FFIV F5 stock price today")');
		});

		it("renders header and summary on separate lines", () => {
			const response = makeSearchResponse({ durationMs: 3000 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!, {
				query: "test",
			});
			const lines = component.render(100);
			const stripped = lines.map(l => stripAnsi(l));
			const headerLine = stripped.find(l => l.includes("Web Search"));
			const summaryLine = stripped.find(l => l.includes("Did 1 search"));
			expect(headerLine).toBeDefined();
			expect(summaryLine).toBeDefined();
			expect(headerLine).not.toBe(summaryLine);
		});
	});
});

describe("web search render — default behavior without Settings", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeEach(async () => {
		theme = await getThemeByName("xcsh-dark");
	});

	it("defaults to compact mode when Settings is not initialized", () => {
		const response = makeSearchResponse({ durationMs: 2000 });
		const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
		const text = stripAnsi(component.render(100).join("\n"));
		expect(text).toContain("Did 1 search in 2s");
		expect(text).not.toContain("Provider:");
	});

	it("renderSearchCall defaults to compact format without Settings", () => {
		const component = renderSearchCall({ query: "test query" }, { expanded: false, isPartial: false }, theme!);
		const text = stripAnsi(component.render(100).join("\n"));
		expect(text).toContain('Web Search("test query")');
	});
});

describe("web search renderResult has no terminal status glyph (#173)", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeEach(async () => {
		theme = await getThemeByName("xcsh-dark");
	});

	it("fallback (no response) renderResult contains no ✓/✗/⚠ after ANSI strip", () => {
		const result = {
			content: [{ type: "text", text: "Some error occurred while searching" }],
			details: undefined,
		};
		const component = renderSearchResult(result as never, { expanded: false, isPartial: false }, theme!);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("fallback (empty content, no response) renderResult contains no ✓/✗/⚠ after ANSI strip", () => {
		const result = {
			content: [{ type: "text", text: "" }],
			details: undefined,
		};
		const component = renderSearchResult(result as never, { expanded: true, isPartial: false }, theme!);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("renderSearchCall (pending call phase) contains no terminal glyphs", () => {
		// renderCall is allowed to emit a pending indicator; we verify that no
		// terminal glyphs (✓/✗/⚠) leak into the call-phase text.
		const component = renderSearchCall({ query: "test" }, { expanded: false, isPartial: true }, theme!);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});
});

describe("web search verbose renderResult header has no terminal status glyph (#173)", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeAll(async () => {
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "web_search.verbose": true } });
	});

	afterAll(() => {
		_resetSettingsForTest();
	});

	beforeEach(async () => {
		theme = await getThemeByName("xcsh-dark");
	});

	function makeVerboseResponse(overrides?: Partial<SearchResponse>): SearchResponse {
		return {
			provider: "anthropic",
			answer: "Answer body",
			sources: [{ title: "Src", url: "https://example.com/a" }],
			usage: { inputTokens: 100, outputTokens: 50, searchRequests: 1 },
			model: "claude-haiku-4-5",
			requestId: "msg_test",
			durationMs: 1000,
			...overrides,
		};
	}

	function makeVerboseResult(response: SearchResponse): {
		content: Array<{ type: string; text?: string }>;
		details: SearchRenderDetails;
	} {
		return {
			content: [{ type: "text", text: response.answer ?? "" }],
			details: { response },
		};
	}

	it("verbose success header contains no ✓/✗/⚠ after ANSI strip", () => {
		const response = makeVerboseResponse();
		const component = renderSearchResult(makeVerboseResult(response), { expanded: false, isPartial: false }, theme!, {
			query: "test query",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		const headerLine = rendered.split("\n")[0] ?? "";
		expect(headerLine).not.toMatch(GLYPH_REGEX);
	});

	it("verbose zero-source header contains no ✓/✗/⚠ after ANSI strip", () => {
		const response = makeVerboseResponse({ sources: [] });
		const component = renderSearchResult(makeVerboseResult(response), { expanded: false, isPartial: false }, theme!, {
			query: "no results",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		const headerLine = rendered.split("\n")[0] ?? "";
		expect(headerLine).not.toMatch(GLYPH_REGEX);
	});
});
