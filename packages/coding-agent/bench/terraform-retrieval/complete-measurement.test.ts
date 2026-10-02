import { expect, test } from "bun:test";
import { measureCompleteRetrieval } from "./complete-measurement";

test("complete measurement interleaves discovery and exact context with deterministic hashes", async () => {
	const calls: string[] = [];
	const uri = "xcsh://terraform-documentation/?search=test";
	const read = async (u: string) => {
		calls.push(u);
		return {
			content:
				u === uri
					? "Selected leaf;\nRead: xcsh://terraform-documentation/documentation/test.md?view=context#field"
					: "Complete field section.",
		};
	};
	const result = await measureCompleteRetrieval(read, uri, 5);
	expect(calls).toHaveLength(10);
	expect(calls[0]).toBe(uri);
	expect(calls[2]).toBe(uri);
	expect(result.routeTimes).toHaveLength(5);
	expect(result.contextTimes).toHaveLength(5);
	expect(result.responseHash).toHaveLength(64);
});
test("complete measurement rejects response drift and oversized responses", async () => {
	let n = 0;
	await expect(measureCompleteRetrieval(async () => ({ content: `No results. ${n++}` }), "query", 2)).rejects.toThrow(
		"Non-deterministic",
	);
	await expect(measureCompleteRetrieval(async () => ({ content: "x".repeat(4097) }), "query", 1)).rejects.toThrow(
		"Discovery budget",
	);
});
