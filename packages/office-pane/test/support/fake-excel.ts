import type { ExcelLike } from "../../src/office/excel-tools";

/** Structural metadata for higher-order Excel tools. */
export interface FakeExcelMeta {
	sheetMeta?: Record<
		string,
		{
			usedRange?: string;
			tables?: string[];
			names?: string[];
			formulas?: Record<string, unknown[][]>;
			numberFormat?: Record<string, string[][]>;
			valueTypes?: Record<string, unknown[][]>;
		}
	>;
	namedRanges?: Record<string, { address: string; values: unknown[][]; notRange?: boolean }>;
	tables?: Record<string, { address: string; values: unknown[][]; columns?: string[] }>;
}

export interface FakeExcelOps {
	sorts: { table: string; fields: { key: number; ascending: boolean }[] }[];
	filters: { table: string; column: string; criteria: { filterOn: string; values: string[] } }[];
}

export interface FakeWorkbookSnapshot {
	activeSheet: string;
	sheets: Record<string, Record<string, unknown[][]>>;
}

export interface FakeExcelWorkbook extends ExcelLike {
	cells: Record<string, unknown[][]>;
	ops: FakeExcelOps;
	activeSheetName(): string;
	sheetNames(): string[];
	sheetCells(name: string): Record<string, unknown[][]>;
	snapshot(): FakeWorkbookSnapshot;
}

function cloneSheets(sheets: Record<string, Record<string, unknown[][]>>): Record<string, Record<string, unknown[][]>> {
	return Object.fromEntries(
		Object.entries(sheets).map(([name, cells]) => [
			name,
			Object.fromEntries(Object.entries(cells).map(([address, values]) => [address, structuredClone(values)])),
		]),
	);
}

/**
 * Stateful multi-sheet `Excel.run` fake shared by unit tests and the live-model
 * Office UAT. The first sheet remains active even when the agent creates reports.
 */
export function fakeExcel(
	seed: Record<string, unknown[][]> = {},
	sheets?: Record<string, Record<string, unknown[][]>>,
	meta: FakeExcelMeta = {},
): FakeExcelWorkbook {
	const sheetStore = sheets ?? { Sheet1: { ...seed } };
	const activeName = Object.keys(sheetStore)[0] ?? "Sheet1";
	if (!(activeName in sheetStore)) sheetStore[activeName] = {};
	const cells = sheetStore[activeName];
	const ops: FakeExcelOps = { sorts: [], filters: [] };
	const namedRanges = meta.namedRanges ?? {};
	const tables = meta.tables ?? {};

	const makeRange = (
		address: string,
		opts: {
			read?: () => unknown[][];
			write?: (value: unknown[][]) => void;
			formulas?: unknown[][];
			numberFormat?: string[][];
			valueTypes?: unknown[][];
			isNullObject?: boolean;
		} = {},
	) => ({
		address,
		isNullObject: opts.isNullObject ?? false,
		get values(): unknown[][] {
			return opts.read?.() ?? [];
		},
		set values(value: unknown[][]) {
			opts.write?.(value);
		},
		formulas: opts.formulas ?? [],
		numberFormat: opts.numberFormat ?? [],
		valueTypes: opts.valueTypes ?? [],
		load(_props: string): void {},
	});

	return {
		cells,
		ops,
		activeSheetName: () => activeName,
		sheetNames: () => Object.keys(sheetStore),
		sheetCells: name => sheetStore[name] ?? {},
		snapshot: () => ({ activeSheet: activeName, sheets: cloneSheets(sheetStore) }),
		run: async <T>(batch: (ctx: never) => Promise<T>): Promise<T> => {
			const makeSheet = (name: string) => {
				const store = sheetStore[name];
				if (!store) throw new Error(`Sheet "${name}" not found`);
				const sheetMeta = meta.sheetMeta?.[name] ?? {};
				return {
					name,
					getRange: (address: string) =>
						makeRange(address, {
							read: () => store[address] ?? [],
							write: value => {
								store[address] = value;
							},
							formulas: sheetMeta.formulas?.[address],
							numberFormat: sheetMeta.numberFormat?.[address],
							valueTypes: sheetMeta.valueTypes?.[address],
						}),
					getUsedRangeOrNullObject: () =>
						makeRange(sheetMeta.usedRange ?? "", {
							read: () => [],
							isNullObject: !sheetMeta.usedRange,
						}),
					tables: {
						items: (sheetMeta.tables ?? []).map(table => ({ name: table })),
						load(_props: string): void {},
					},
					names: {
						items: (sheetMeta.names ?? []).map(namedRange => ({ name: namedRange })),
						load(_props: string): void {},
					},
				};
			};
			const makeTable = (name: string) => {
				const table = tables[name];
				if (!table) throw new Error(`Table "${name}" not found`);
				const columns = table.columns ?? [];
				return {
					name,
					getDataBodyRange: () => makeRange(table.address, { read: () => table.values }),
					columns: {
						items: columns.map(column => ({ name: column })),
						load(_props: string): void {},
						getItem: (column: string) => ({
							name: column,
							index: columns.indexOf(column),
							filter: {
								apply(criteria: { filterOn: string; values: string[] }): void {
									ops.filters.push({ table: name, column, criteria });
								},
							},
						}),
					},
					sort: {
						apply(fields: { key: number; ascending: boolean }[]): void {
							ops.sorts.push({ table: name, fields });
						},
					},
				};
			};
			const worksheets = {
				getActiveWorksheet: () => makeSheet(activeName),
				getItem: (name: string) => makeSheet(name),
				getItemOrNullObject: (name: string) => ({
					isNullObject: !(name in sheetStore),
					load(_props: string): void {},
				}),
				add: (name: string) => {
					if (name in sheetStore) throw new Error(`ItemAlreadyExists: ${name}`);
					sheetStore[name] = {};
					return makeSheet(name);
				},
				get items() {
					return Object.keys(sheetStore).map(makeSheet);
				},
				load(_props: string): void {},
			};
			const ctx = {
				workbook: {
					worksheets,
					names: {
						items: Object.keys(namedRanges).map(name => ({ name })),
						load(_props: string): void {},
						getItem: (name: string) => {
							const namedRange = namedRanges[name];
							if (!namedRange) throw new Error(`Named range "${name}" not found`);
							return {
								getRangeOrNullObject: () =>
									makeRange(namedRange.address, {
										read: () => namedRange.values,
										isNullObject: namedRange.notRange ?? false,
									}),
							};
						},
					},
					tables: { getItem: (name: string) => makeTable(name) },
				},
				sync: async (): Promise<void> => {},
			};
			return batch(ctx as never);
		},
	};
}
