import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import type { DomDocument } from "../../src/browser/dom-context";
import { findSectionContainer, normLabel } from "../../src/browser/dom-context";

const htmlPath = join(import.meta.dir, "fixtures/xc-http-lb-create.html");
const html = readFileSync(htmlPath, "utf-8");
const { document } = parseHTML(`<html><body>${html}</body></html>`);

// linkedom's document is structurally compatible with DomDocument
const doc = document as unknown as DomDocument;

describe("normLabel", () => {
	it("strips leading asterisk", () => {
		expect(normLabel("*Domains")).toBe("Domains");
	});
	it("trims whitespace", () => {
		expect(normLabel("  Origin Pools  ")).toBe("Origin Pools");
	});
	it("collapses internal whitespace", () => {
		expect(normLabel("Origin   Pools")).toBe("Origin Pools");
	});
	it("does not strip non-leading asterisks", () => {
		expect(normLabel("Foo*Bar")).toBe("Foo*Bar");
	});
});

describe("findSectionContainer", () => {
	it("returns null for nonexistent phrase", () => {
		expect(findSectionContainer(doc, "Nonexistent")).toBeNull();
	});

	it("finds the Domains table container with an 'Add Item' button", () => {
		const d = findSectionContainer(doc, "Domains table");
		expect(d).not.toBeNull();
		const buttons = Array.from(d!.querySelectorAll("button"));
		expect(buttons.some(b => (b.textContent ?? "").trim() === "Add Item")).toBe(true);
	});

	it("finds the Origin Pools section container with an 'Add Item' button", () => {
		const o = findSectionContainer(doc, "Origin Pools section");
		expect(o).not.toBeNull();
		const buttons = Array.from(o!.querySelectorAll("button"));
		expect(buttons.some(b => (b.textContent ?? "").trim() === "Add Item")).toBe(true);
	});

	it("Domains and Origin Pools containers are distinct elements", () => {
		const d = findSectionContainer(doc, "Domains table");
		const o = findSectionContainer(doc, "Origin Pools section");
		expect(d).not.toBeNull();
		expect(o).not.toBeNull();
		expect(d).not.toBe(o);
	});
});
