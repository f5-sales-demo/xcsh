import { describe, expect, it } from "bun:test";
import type { AxNode } from "../../src/browser/ax";
import { AmbiguousError, matchNode, matchNodes, NotFoundError } from "../../src/browser/ax";
import { parseLocator } from "../../src/browser/selector";
import fixture from "./fixtures/xc-http-lb-create.ax.json";

const tree = fixture as unknown as AxNode;

describe("matchNode", () => {
	it("matches textbox by role+name", () => {
		const node = matchNode(tree, parseLocator("textbox[name='Name']"));
		expect(node.role).toBe("textbox");
		expect(node.name).toBe("Name");
	});

	it("matches tab by role+text", () => {
		const node = matchNode(tree, parseLocator("tab:text('Add HTTP Load Balancer')"));
		expect(node.role).toBe("tab");
	});

	it("matches button by role+text (footer save, not the tab)", () => {
		const node = matchNode(tree, parseLocator("button:text('Add HTTP Load Balancer')"));
		expect(node.role).toBe("button");
	});

	it("returns first match when text locator matches multiple nodes", () => {
		// "HTTP Load Balancers" appears in multiple nodes; text kind returns the first match without throwing
		const node = matchNode(tree, parseLocator("text('HTTP Load Balancers')"));
		expect(node.name).toBeDefined();
		expect(node.name).toContain("HTTP Load Balancers");
	});

	it("throws AmbiguousError when multiple buttons match 'Add Item'", () => {
		expect(() => matchNode(tree, parseLocator("button:text('Add Item')"))).toThrow(AmbiguousError);
	});

	it("throws NotFoundError when name does not exist", () => {
		expect(() => matchNode(tree, parseLocator("textbox[name='Nope']"))).toThrow(NotFoundError);
	});

	it("throws for css kind (not resolvable in AX tree)", () => {
		expect(() => matchNode(tree, { kind: "css", css: "button" })).toThrow();
	});

	it("throws NotFoundError for text kind not-found with candidate text", () => {
		let thrownError: Error | null = null;
		try {
			matchNode(tree, parseLocator("text('NoSuchVisibleText 12345')"));
		} catch (e) {
			thrownError = e as Error;
		}
		expect(thrownError).toBeInstanceOf(NotFoundError);
		// Verify error message contains diagnostic context
		const msg = thrownError?.message || "";
		expect(msg).toMatch(/nearby text candidates/);
	});

	it("throws NotFoundError for role kind not-found with candidates or graceful message", () => {
		// "slider" role doesn't exist in fixture (verified above)
		let thrownError: Error | null = null;
		try {
			matchNode(tree, parseLocator("slider"));
		} catch (e) {
			thrownError = e as Error;
		}
		expect(thrownError).toBeInstanceOf(NotFoundError);
		// Message should be well-formed even if no candidates
		const msg = thrownError?.message || "";
		expect(msg).toMatch(/No AX node found/);
		// Should not throw when rendering (no TypeError on undefined hint)
		expect(msg.length).toBeGreaterThan(0);
	});
});

describe("matchNodes", () => {
	it("returns all matches for ambiguous button locator (>= 2 results)", () => {
		const results = matchNodes(tree, parseLocator("button:text('Add Item')"));
		expect(results.length).toBeGreaterThanOrEqual(2);
		for (const n of results) {
			expect(n.role).toBe("button");
		}
	});

	it("returns a single match for unique textbox[name='Name']", () => {
		const results = matchNodes(tree, parseLocator("textbox[name='Name']"));
		expect(results.length).toBe(1);
		expect(results[0]!.role).toBe("textbox");
		expect(results[0]!.name).toBe("Name");
	});

	it("returns empty array when nothing matches", () => {
		const results = matchNodes(tree, parseLocator("textbox[name='NoSuchField 99999']"));
		expect(results.length).toBe(0);
	});

	it("throws for css kind (not resolvable in AX tree)", () => {
		expect(() => matchNodes(tree, { kind: "css", css: "button" })).toThrow();
	});
});
