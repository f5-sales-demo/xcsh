/**
 * Reference extraction for the panel Sources chips (#2237) must not swallow
 * trailing markdown emphasis / sentence punctuation into a bare URL. Regression
 * found via live E2E UAT on v19.83.0 (a bolded link produced `.../llms.txt**`).
 * See issue #2249.
 */
import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
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
