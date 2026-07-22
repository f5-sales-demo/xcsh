import { describe, expect, it } from "bun:test";
import { getBundledAgent } from "../../src/task/agents";

describe("librarian agent definition", () => {
	it("advertises documentation research in its description", () => {
		const librarian = getBundledAgent("librarian");
		expect(librarian).toBeDefined();
		expect(librarian?.description.toLowerCase()).toContain("documentation");
	});

	it("has a documentation-research branch in its procedure", () => {
		const librarian = getBundledAgent("librarian");
		expect(librarian?.systemPrompt).toContain("For documentation questions");
	});
});
