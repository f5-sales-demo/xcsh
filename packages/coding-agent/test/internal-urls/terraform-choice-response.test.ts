import { expect, test } from "bun:test";
import { terraformChoiceResponse } from "../../src/internal-urls/terraform-choice-response";

test("choice pages preserve complete destinations and caller scope", () => {
	const request = new URL("xcsh://terraform-documentation/?search=certificate&node=root&category=security");
	const entries = Array.from(
		{ length: 5 },
		(_, i) => `## Choice ${i}\nRefine: xcsh://terraform-documentation/?node=${i}\n${"x".repeat(1400)}`,
	);
	let after: string | null = null;
	const seen: string[] = [];
	for (let n = 0; n < 5; n++) {
		const response = terraformChoiceResponse("Provenance", entries, request, after);
		expect(Buffer.byteLength(response)).toBeLessThanOrEqual(4096);
		seen.push(...[...response.matchAll(/^## Choice (\d+)/gm)].map(m => m[1]!));
		const next = response.match(/^Continue: (.+)$/m)?.[1];
		if (!next) break;
		const url = new URL(next);
		expect(url.searchParams.get("category")).toBe("security");
		expect(url.searchParams.get("search")).toBe("certificate");
		after = url.searchParams.get("choice_after");
	}
	expect(seen).toEqual(["0", "1", "2", "3", "4"]);
});
test("invalid cursors and indivisible oversized choices fail explicitly", () => {
	const url = new URL("xcsh://terraform-documentation/?search=x");
	for (const cursor of ["-1", "1.5", "01", "2", "NaN"])
		expect(() => terraformChoiceResponse("Prefix", ["a", "b"], url, cursor)).toThrow("continuation");
	expect(() => terraformChoiceResponse("Prefix", ["x".repeat(5000)], url, null)).toThrow("budget");
	expect(() => terraformChoiceResponse("x".repeat(5000), [], url, null)).toThrow("budget");
});
