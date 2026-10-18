import type { BoxSymbols } from "../symbols";
import { padding, visibleWidth, wrapTextWithAnsi } from "../utils";

export interface TableTheme {
	symbols: BoxSymbols;
	bold(text: string): string;
}
function longestWordWidth(text: string, maxWidth: number): number {
	return Math.min(maxWidth, Math.max(1, ...text.split(/\s+/).map(visibleWidth)));
}
/** Width includes borders and cell padding. Narrow records reflow without losing fields. */
export function renderTable(
	headers: readonly string[],
	rows: readonly (readonly string[])[],
	availableWidth: number,
	theme: TableTheme,
	alignment?: readonly ("left" | "right" | "center" | null)[],
	columnSizing?: readonly { minWidth?: number; maxWidth?: number }[],
): string[] {
	const lines: string[] = [];
	const numCols = headers.length;

	if (numCols === 0) {
		return lines;
	}

	// Calculate border overhead: "│ " + (n-1) * " │ " + " │"
	// = 2 + (n-1) * 3 + 2 = 3n + 1
	const borderOverhead = 3 * numCols + 1;
	const availableForCells = availableWidth - borderOverhead;
	const reflow = (): string[] => {
		const records = rows.length ? rows : [headers.map(() => "")];
		for (const row of records) {
			for (let i = 0; i < numCols; i++) {
				lines.push(...wrapTextWithAnsi(`${theme.bold(headers[i])}: ${row[i] ?? ""}`, Math.max(1, availableWidth)));
			}
			lines.push("");
		}
		return lines;
	};
	if (availableForCells < numCols * 6) return reflow();

	const maxUnbrokenWordWidth = 30;

	// Calculate natural column widths (what each column needs without constraints)
	const naturalWidths: number[] = [];
	const minWordWidths: number[] = [];
	for (let i = 0; i < numCols; i++) {
		const headerText = headers[i];
		naturalWidths[i] = visibleWidth(headerText);
		minWordWidths[i] = Math.max(1, longestWordWidth(headerText, maxUnbrokenWordWidth));
	}
	for (const row of rows) {
		for (let i = 0; i < row.length; i++) {
			const cellText = row[i];
			naturalWidths[i] = Math.max(naturalWidths[i] || 0, visibleWidth(cellText));
			minWordWidths[i] = Math.max(minWordWidths[i] || 1, longestWordWidth(cellText, maxUnbrokenWordWidth));
		}
	}
	const readableWidths = naturalWidths.map((natural, index) => {
		const declared = columnSizing?.[index]?.minWidth;
		return Number.isFinite(declared) ? Math.max(1, Math.floor(declared!)) : Math.min(6, natural);
	});
	if (readableWidths.reduce((sum, width) => sum + width, 0) > availableForCells) return reflow();
	for (let i = 0; i < numCols; i++) {
		const max = columnSizing?.[i]?.maxWidth;
		if (Number.isFinite(max))
			naturalWidths[i] = Math.min(naturalWidths[i], Math.max(readableWidths[i], Math.floor(max!)));
		naturalWidths[i] = Math.max(naturalWidths[i], readableWidths[i]);
		minWordWidths[i] = Math.max(readableWidths[i], Math.min(minWordWidths[i], naturalWidths[i]));
	}

	let minColumnWidths = minWordWidths;
	let minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);

	if (minCellsWidth > availableForCells) {
		minColumnWidths = new Array(numCols).fill(1);
		const remaining = availableForCells - numCols;

		if (remaining > 0) {
			const totalWeight = minWordWidths.reduce((total, width) => total + Math.max(0, width - 1), 0);
			const growth = minWordWidths.map(width => {
				const weight = Math.max(0, width - 1);
				return totalWeight > 0 ? Math.floor((weight / totalWeight) * remaining) : 0;
			});

			for (let i = 0; i < numCols; i++) {
				minColumnWidths[i] += growth[i] ?? 0;
			}

			const allocated = growth.reduce((total, width) => total + width, 0);
			let leftover = remaining - allocated;
			for (let i = 0; leftover > 0 && i < numCols; i++) {
				minColumnWidths[i]++;
				leftover--;
			}
		}

		minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
	}

	// Calculate column widths that fit within available width
	const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
	let columnWidths: number[];

	if (totalNaturalWidth <= availableWidth) {
		// Everything fits naturally
		columnWidths = naturalWidths.map((width, index) => Math.max(width, minColumnWidths[index]));
	} else {
		// Need to shrink columns to fit
		const totalGrowPotential = naturalWidths.reduce((total, width, index) => {
			return total + Math.max(0, width - minColumnWidths[index]);
		}, 0);
		const extraWidth = Math.max(0, availableForCells - minCellsWidth);
		columnWidths = minColumnWidths.map((minWidth, index) => {
			const naturalWidth = naturalWidths[index];
			const minWidthDelta = Math.max(0, naturalWidth - minWidth);
			let grow = 0;
			if (totalGrowPotential > 0) {
				grow = Math.floor((minWidthDelta / totalGrowPotential) * extraWidth);
			}
			return minWidth + grow;
		});

		// Adjust for rounding errors - distribute remaining space
		const allocated = columnWidths.reduce((a, b) => a + b, 0);
		let remaining = availableForCells - allocated;
		while (remaining > 0) {
			let grew = false;
			for (let i = 0; i < numCols && remaining > 0; i++) {
				if (columnWidths[i] < naturalWidths[i]) {
					columnWidths[i]++;
					remaining--;
					grew = true;
				}
			}
			if (!grew) {
				break;
			}
		}
	}

	if (columnWidths.some((width, index) => width < readableWidths[index])) return reflow();

	const t = theme.symbols;
	const h = t.horizontal;
	const v = t.vertical;

	// Render top border
	const topBorderCells = columnWidths.map(w => h.repeat(w));
	lines.push(`${t.topLeft}${h}${topBorderCells.join(`${h}${t.teeDown}${h}`)}${h}${t.topRight}`);

	// Render header with wrapping
	const headerCellLines: string[][] = headers.map((text, i) => wrapTextWithAnsi(text, columnWidths[i]));
	const headerLineCount = Math.max(...headerCellLines.map(c => c.length));

	for (let lineIdx = 0; lineIdx < headerLineCount; lineIdx++) {
		const rowParts = headerCellLines.map((cellLines, colIdx) => {
			const text = cellLines[lineIdx] || "";
			const padded = text + padding(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
			return theme.bold(padded);
		});
		lines.push(`${v} ${rowParts.join(` ${v} `)} ${v}`);
	}

	// Render separator
	const separatorCells = columnWidths.map(w => h.repeat(w));
	const separatorLine = `${t.teeRight}${h}${separatorCells.join(`${h}${t.cross}${h}`)}${h}${t.teeLeft}`;
	lines.push(separatorLine);

	// Render rows with wrapping
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		const row = rows[rowIndex];
		const rowCellLines: string[][] = headers.map((_, i) => wrapTextWithAnsi(row[i] ?? "", columnWidths[i]));
		const rowLineCount = Math.max(...rowCellLines.map(c => c.length));

		for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
			const rowParts = rowCellLines.map((cellLines, colIdx) => {
				const text = cellLines[lineIdx] || "";
				const pad = padding(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
				const numeric =
					alignment?.[colIdx] === "right" ||
					(alignment?.[colIdx] !== "left" &&
						rows.every(row => !row[colIdx] || /^-?\d+(?:[.,]\d+)*%?$/.test(row[colIdx])));
				return numeric ? pad + text : text + pad;
			});
			lines.push(`${v} ${rowParts.join(` ${v} `)} ${v}`);
		}

		if (rowIndex < rows.length - 1) {
			lines.push(separatorLine);
		}
	}

	// Render bottom border
	const bottomBorderCells = columnWidths.map(w => h.repeat(w));
	lines.push(`${t.bottomLeft}${h}${bottomBorderCells.join(`${h}${t.teeUp}${h}`)}${h}${t.bottomRight}`);

	return lines;
}
