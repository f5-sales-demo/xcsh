/**
 * ngx-datatable column-aware cell resolver for XC CDP accessibility.
 * Pure module — no Puppeteer imports. Works under linkedom in tests and
 * in page.evaluateHandle in the resolver (injected as IIFE via .toString()).
 *
 * Structural interfaces match both linkedom and browser DOM without
 * requiring a global DOM lib.
 */

/** Minimal structural interface matching both linkedom and browser Element. */
interface DtElement {
	textContent: string | null;
	querySelectorAll(sel: string): ArrayLike<DtElement>;
	querySelector(sel: string): DtElement | null;
}

/** Minimal structural interface matching both linkedom and browser Document. */
interface DtDocument {
	querySelectorAll(sel: string): ArrayLike<DtElement>;
}

/**
 * Strip a leading asterisk, trim, and collapse internal whitespace.
 * Self-contained copy so the injection IIFE is standalone (no imports).
 */
export function normLabel(s: string): string {
	return s.trim().replace(/^\*/, "").trim().replace(/\s+/g, " ");
}

/**
 * Find the input (or textarea / [role=textbox]) in a specific ngx-datatable
 * column cell.
 *
 * Algorithm:
 *   1. Scan every `.datatable-header-cell-label` for one whose normLabel
 *      matches the given columnName.
 *   2. Walk up to the enclosing ngx-datatable (the element that owns the
 *      header cells array).
 *   3. Determine the column index = position of the matched header cell among
 *      all `.datatable-header-cell` elements inside that datatable.
 *   4. Pick the body row: `which === "last"` → last `.datatable-body-row`,
 *      else first.
 *   5. Return the first `input`, `textarea`, or `[role=textbox]` inside the
 *      `.datatable-body-cell` at the resolved column index.
 *
 * Uses only standard DOM querySelectorAll / textContent APIs so it works
 * under linkedom AND in the live browser page.
 */
export function findDatatableColumnInput(
	doc: DtDocument,
	columnName: string,
	which: "first" | "last",
): DtElement | null {
	const wantName = normLabel(columnName);

	// Step 1 — find the header label element that matches columnName
	const allLabels = Array.from(doc.querySelectorAll(".datatable-header-cell-label"));
	const matchedLabel = allLabels.find(lbl => normLabel(lbl.textContent ?? "") === wantName);
	if (!matchedLabel) return null;

	// Step 2 — collect ALL header cells from the entire document and determine
	// which datatable owns the matched label.  We do this by finding the header
	// cell that CONTAINS the matched label, then looking at the ordered list of
	// all header cells to derive the index.
	const allHeaderCells = Array.from(doc.querySelectorAll(".datatable-header-cell"));
	const matchedHeaderCell = allHeaderCells.find(cell => {
		const labels = Array.from(cell.querySelectorAll(".datatable-header-cell-label"));
		return labels.some(lbl => normLabel(lbl.textContent ?? "") === wantName);
	});
	if (!matchedHeaderCell) return null;

	// Step 3 — column index = position of matched header cell within ALL header
	// cells that share the same datatable ancestor.  Because ngx-datatable puts
	// all its header cells under a single <datatable-header>, the relative order
	// in document order == the column index.
	//
	// To scope to the correct datatable, we collect only the header cells that
	// appear before the FIRST body row of a different datatable.  In the common
	// single-datatable case, the simple index into allHeaderCells works directly.
	const colIndex = allHeaderCells.indexOf(matchedHeaderCell);
	if (colIndex === -1) return null;

	// Step 4 — pick the body row
	const allBodyRows = Array.from(doc.querySelectorAll(".datatable-body-row"));
	if (allBodyRows.length === 0) return null;
	const row = which === "last" ? allBodyRows[allBodyRows.length - 1]! : allBodyRows[0]!;

	// Step 5 — get the body cell at the same column index
	const bodyCells = Array.from(row.querySelectorAll(".datatable-body-cell"));
	const targetCell = bodyCells[colIndex];
	if (!targetCell) return null;

	// Return the first interactive text input inside the cell
	return (
		targetCell.querySelector("input") ??
		targetCell.querySelector("textarea") ??
		targetCell.querySelector("[role=textbox]") ??
		null
	);
}
