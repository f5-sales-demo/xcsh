import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { findDatatableColumnInput } from "../../src/browser/dt-context";

const htmlPath = join(import.meta.dir, "fixtures/xc-domains-datatable.html");
const html = readFileSync(htmlPath, "utf-8");
const { document } = parseHTML(`<html><body>${html}</body></html>`);

// linkedom's document is structurally compatible with the DtDocument interface
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const doc = document as any;

describe("findDatatableColumnInput", () => {
	it("returns non-null input for 'Domains' first row", () => {
		const el = findDatatableColumnInput(doc, "Domains", "first");
		expect(el).not.toBeNull();
		expect((el as any).tagName.toUpperCase()).toBe("INPUT");
	});

	it("strips leading asterisk — '*Domains' resolves last row", () => {
		const el = findDatatableColumnInput(doc, "*Domains", "last");
		expect(el).not.toBeNull();
	});

	it("first and last row inputs are different elements (2 rows)", () => {
		const first = findDatatableColumnInput(doc, "Domains", "first");
		const last = findDatatableColumnInput(doc, "Domains", "last");
		expect(first).not.toBeNull();
		expect(last).not.toBeNull();
		expect(first).not.toBe(last);
	});

	it("returns null for a nonexistent column name", () => {
		const el = findDatatableColumnInput(doc, "Nonexistent", "first");
		expect(el).toBeNull();
	});
});
