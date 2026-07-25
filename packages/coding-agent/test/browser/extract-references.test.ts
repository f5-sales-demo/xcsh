/**
 * Reference extraction for the panel Sources chips (#2237) must not swallow
 * trailing markdown emphasis / sentence punctuation into a bare URL. Regression
 * found via live E2E UAT on v19.83.0 (a bolded link produced `.../llms.txt**`).
 * See issue #2249.
 */
import { describe, expect, test } from "bun:test";
import type { AssistantMessage, WebCitation } from "@f5-sales-demo/pi-ai";
import { extractReferences } from "../../src/browser/chat-handler";

/** Minimal AssistantMessage carrying a single text block. */
function assistantText(text: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text }] } as unknown as AssistantMessage;
}

describe("extractReferences", () => {
	test("strips trailing markdown bold (**) from a bolded bare URL", () => {
		const refs = extractReferences(assistantText("See **https://docs.cloud.f5.com/waf** for details."));
		expect(refs).toHaveLength(1);
		expect(refs[0].url).toBe("https://docs.cloud.f5.com/waf");
		expect(refs[0].title).toBe("waf"); // clean, no trailing '*'
	});

	test("drops a sentence-final period after a bare URL", () => {
		const refs = extractReferences(assistantText("Docs: https://docs.cloud.f5.com/api."));
		expect(refs[0].url).toBe("https://docs.cloud.f5.com/api");
	});

	test("drops trailing wrap punctuation (comma, close paren from prose)", () => {
		const refs = extractReferences(assistantText("(see https://docs.cloud.f5.com/lb), then continue"));
		expect(refs[0].url).toBe("https://docs.cloud.f5.com/lb");
	});

	test("leaves a clean bare URL untouched", () => {
		const refs = extractReferences(assistantText("https://docs.cloud.f5.com/waf"));
		expect(refs[0].url).toBe("https://docs.cloud.f5.com/waf");
	});

	test("strips a trailing markdown code backtick from a code-wrapped bare URL (#2256)", () => {
		const refs = extractReferences(assistantText("Docs: `https://docs.cloud.f5.com/waf` — enjoy"));
		expect(refs).toHaveLength(1);
		expect(refs[0].url).toBe("https://docs.cloud.f5.com/waf");
		expect(refs[0].title).toBe("waf");
	});

	test("handles the exact v19.85.0 UAT strings (backtick-wrapped docs URLs)", () => {
		const refs = extractReferences(
			assistantText(
				"See `https://f5-sales-demo.github.io/docs/llms.txt` and `https://f5-sales-demo.github.io/api-specs-enriched/en/`",
			),
		);
		expect(refs.map(r => r.url)).toEqual([
			"https://f5-sales-demo.github.io/docs/llms.txt",
			"https://f5-sales-demo.github.io/api-specs-enriched/en/",
		]);
	});

	test("markdown-link references are unaffected", () => {
		const refs = extractReferences(assistantText("[WAF guide](https://docs.cloud.f5.com/waf)"));
		expect(refs).toHaveLength(1);
		expect(refs[0].title).toBe("WAF guide");
		expect(refs[0].url).toBe("https://docs.cloud.f5.com/waf");
	});

	test("dedupes a bolded and a plain occurrence of the same cleaned URL", () => {
		const refs = extractReferences(
			assistantText("**https://docs.cloud.f5.com/waf** and again https://docs.cloud.f5.com/waf"),
		);
		expect(refs).toHaveLength(1);
	});
});

/**
 * Structured citations from a provider-side web search (#2340). Regex scraping can only find
 * URLs the model happened to print, and can only guess a title from the URL path — the citations
 * carry the real page title, so they must take precedence.
 */
describe("extractReferences — structured web-search citations", () => {
	/** An AssistantMessage whose text block carries provider citations. */
	function assistantCited(text: string, citations: WebCitation[]): AssistantMessage {
		return { role: "assistant", content: [{ type: "text", text, citations }] } as unknown as AssistantMessage;
	}

	const CITATION: WebCitation = {
		type: "web_search_result_location",
		url: "https://docs.nginx.com/nginx/releases/",
		title: "NGINX Plus Releases",
		citedText: "R34 is the latest",
	};

	test("surfaces a citation even when the prose prints no URL at all", () => {
		const refs = extractReferences(assistantCited("NGINX Plus R34 is the latest release.", [CITATION]));
		expect(refs).toHaveLength(1);
		expect(refs[0].url).toBe(CITATION.url);
		expect(refs[0].title).toBe("NGINX Plus Releases");
	});

	test("citation title WINS over the title the regex would scrape from the URL", () => {
		const refs = extractReferences(assistantCited(`See ${CITATION.url} for details.`, [CITATION]));
		expect(refs).toHaveLength(1); // deduped, not doubled
		expect(refs[0].title).toBe("NGINX Plus Releases"); // not "releases" from the path
	});

	test("falls back to a URL-derived title when the citation has none", () => {
		const refs = extractReferences(
			assistantCited("Answer.", [{ type: "web_search_result_location", url: "https://docs.cloud.f5.com/waf" }]),
		);
		expect(refs).toHaveLength(1);
		expect(refs[0].title).toBe("waf");
	});

	test("dedupes repeated citations of the same URL", () => {
		const refs = extractReferences(assistantCited("Answer.", [CITATION, { ...CITATION, citedText: "another span" }]));
		expect(refs).toHaveLength(1);
	});

	test("still picks up prose URLs that were not cited", () => {
		const refs = extractReferences(assistantCited(`Also https://docs.cloud.f5.com/lb helps.`, [CITATION]));
		expect(refs.map(r => r.url)).toEqual([CITATION.url, "https://docs.cloud.f5.com/lb"]);
	});
});
