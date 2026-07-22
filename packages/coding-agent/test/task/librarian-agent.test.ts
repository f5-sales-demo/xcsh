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

	it("treats source line numbers as optional (for documentation citations)", () => {
		const librarian = getBundledAgent("librarian");
		const output = librarian?.output as {
			properties?: {
				sources?: {
					elements?: {
						properties?: Record<string, unknown>;
						optionalProperties?: Record<string, unknown>;
					};
				};
			};
		};
		const elements = output?.properties?.sources?.elements;
		expect(elements?.properties?.line_start).toBeUndefined();
		expect(elements?.properties?.line_end).toBeUndefined();
		expect(elements?.optionalProperties?.line_start).toBeDefined();
		expect(elements?.optionalProperties?.line_end).toBeDefined();
		// code fields remain required
		expect(elements?.properties?.excerpt).toBeDefined();
	});
});
