import { describe, expect, it } from "bun:test";
import type { AxNode } from "../../src/browser/ax";
import { AmbiguousError, matchNode, NotFoundError } from "../../src/browser/ax";
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

	it("throws AmbiguousError when multiple buttons match 'Add Item'", () => {
		expect(() => matchNode(tree, parseLocator("button:text('Add Item')"))).toThrow(AmbiguousError);
	});

	it("throws NotFoundError when name does not exist", () => {
		expect(() => matchNode(tree, parseLocator("textbox[name='Nope']"))).toThrow(NotFoundError);
	});

	it("throws for css kind (not resolvable in AX tree)", () => {
		expect(() => matchNode(tree, { kind: "css", css: "button" })).toThrow();
	});
});
