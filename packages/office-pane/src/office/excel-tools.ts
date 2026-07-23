/**
 * Office.js Excel document tools.
 *
 * These are the concrete host tools the agent invokes to read and write the
 * active worksheet. They plug into the transport-neutral {@link HostToolDispatcher}:
 * the dispatcher advertises them via `set_host_tools`, routes each
 * `host_tool_call` here, and returns our {@link AgentToolResult} (a `content[]`
 * array) over the wire.
 *
 * The concrete `Excel.run` runtime is injected as {@link ExcelLike} (defaulting
 * to the page-global `Excel`) so the tools are unit-testable with no Office
 * runtime and the module stays free of hard Office.js coupling.
 */
import { type AgentToolResult, HostToolDispatcher, type HostToolRegistration, type Transport } from "../core";

/** A loadable collection of `{ name }` items (tables, columns, named ranges). */
export interface ExcelNamedItemCollectionLike {
	/** After `load("items/name")` + `sync()`, the array of `{ name }` entries. */
	items: { name: string }[];
	/** Queue a property (e.g. `"items/name"`) to load on the next `sync()`. */
	load(properties: string): void;
}

/** A worksheet range — the subset of `Excel.Range` these tools touch. */
export interface ExcelRangeLike {
	/** The range's A1 address (sheet-qualified), loaded via `load("address")`. */
	address: string;
	/** 2D grid of cell values (rows of columns). */
	values: unknown[][];
	/** 2D grid of cell formulas (rows of columns), loaded via `load("formulas")`. */
	formulas: unknown[][];
	/** 2D grid of number-format strings, loaded via `load("numberFormat")`. */
	numberFormat: string[][];
	/** 2D grid of value-type tags, loaded via `load("valueTypes")`. */
	valueTypes: unknown[][];
	/** Queue a property (e.g. `"values"`) to load on the next `sync()`. */
	load(properties: string): void;
}

/** A single worksheet — the subset these tools touch. */
export interface ExcelWorksheetLike {
	/** The tab name shown in the Excel sheet tab bar. */
	name: string;
	getRange(address: string): ExcelRangeLike;
	/** The rectangle covering all cells with content (for structural discovery). */
	getUsedRange(): ExcelRangeLike;
	/** The Excel Tables anchored on this sheet. */
	getTables(): ExcelNamedItemCollectionLike;
	/** The sheet-scoped named ranges. */
	names: ExcelNamedItemCollectionLike;
}

/** A single column of an Excel Table — the subset these tools touch. */
export interface ExcelTableColumnLike {
	name: string;
	/** Zero-based column index within the table. */
	index: number;
	/** Auto-filter for this column. */
	filter: { apply(criteria: { filterOn: string; values: string[] }): void };
}

/** An Excel Table — the subset the table tools touch. */
export interface ExcelTableLike {
	name: string;
	getRange(): ExcelRangeLike;
	columns: ExcelNamedItemCollectionLike & { getItem(name: string): ExcelTableColumnLike };
	/** Table sort surface. */
	sort: { apply(fields: { key: number; ascending: boolean }[]): void };
}

/** The worksheets collection — active sheet, by-name lookup, and enumeration. */
export interface ExcelWorksheetCollectionLike {
	getActiveWorksheet(): ExcelWorksheetLike;
	/** Look up a worksheet by its tab name (for cross-sheet reads like `Sheet2!A1:B3`). */
	getItem(name: string): ExcelWorksheetLike;
	/** After `load("items")` + `sync()`, the array of all worksheets. */
	items: ExcelWorksheetLike[];
	/** Queue a property (e.g. `"items"`) to load on the next `sync()`. */
	load(properties: string): void;
}

/** The subset of the `Excel.RequestContext` batch object these tools use. */
export interface ExcelRequestContextLike {
	workbook: {
		worksheets: ExcelWorksheetCollectionLike;
		/** Workbook-level named ranges: enumerable and resolvable by name. */
		names: ExcelNamedItemCollectionLike & { getItem(name: string): { getRange(): ExcelRangeLike } };
		/** Workbook-level Excel Tables, resolvable by name. */
		tables: { getItem(name: string): ExcelTableLike };
	};
	/** Flush queued reads/writes to the document. */
	sync(): Promise<void>;
}

/**
 * Parse a potentially sheet-qualified A1 address. `Sheet2!A1:B3` → `{ sheet: "Sheet2", range: "A1:B3" }`.
 * A bare `A1:B3` → `{ sheet: null, range: "A1:B3" }` (active sheet).
 * Handles quoted sheet names: `'My Sheet'!A1` → sheet `My Sheet`.
 */
export function parseSheetAddress(input: string): { sheet: string | null; range: string } {
	// Quoted sheet name: 'Sheet Name'!A1:B3 (Excel doubles internal apostrophes: 'John''s'!A1)
	const quoted = input.match(/^'((?:[^']|'')+)'!(.+)$/);
	if (quoted) return { sheet: quoted[1].replace(/''/g, "'"), range: quoted[2] };
	// Unquoted: Sheet2!A1:B3
	const unquoted = input.match(/^([A-Za-z0-9_. -]+)!(.+)$/);
	if (unquoted) return { sheet: unquoted[1], range: unquoted[2] };
	// No sheet prefix → active sheet.
	return { sheet: null, range: input };
}

/** Resolve a worksheet from the collection: by name if specified, else the active one. */
function resolveWorksheet(worksheets: ExcelWorksheetCollectionLike, sheetName: string | null): ExcelWorksheetLike {
	return sheetName ? worksheets.getItem(sheetName) : worksheets.getActiveWorksheet();
}

/** The `Excel.run` seam — injected so the tools need no Office runtime in tests. */
export interface ExcelLike {
	run<T>(batch: (context: ExcelRequestContextLike) => Promise<T>): Promise<T>;
}

/** Resolve the page-global `Excel`; overridable via injection. */
function getExcel(): ExcelLike {
	const excel = (globalThis as { Excel?: ExcelLike }).Excel;
	if (!excel) {
		throw new Error("Excel.js runtime is not available on the global scope");
	}
	return excel;
}

function textResult<T extends Record<string, unknown>>(text: string, details?: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

/**
 * Turn an OfficeExtension.Error-like failure into an actionable message that
 * carries the Office `code` and `debugInfo` — so a failed Excel.run surfaces
 * *why* ("[InvalidOperation] …") instead of the opaque default string.
 */
function describeExcelError(op: string, address: string, err: unknown): string {
	const e = err as { code?: unknown; message?: unknown; debugInfo?: unknown };
	const code = typeof e?.code === "string" && e.code ? ` [${e.code}]` : "";
	const message = typeof e?.message === "string" && e.message ? e.message : String(err);
	let debug = "";
	if (e?.debugInfo && typeof e.debugInfo === "object") {
		try {
			debug = ` debugInfo=${JSON.stringify(e.debugInfo)}`;
		} catch {
			/* non-serializable debugInfo — omit */
		}
	}
	return `${op}(${address}) failed${code}: ${message}${debug}`;
}

/** Read `arguments.address` as a non-empty A1-style range address, or throw. */
function requireAddress(args: Record<string, unknown>): string {
	const address = typeof args.address === "string" ? args.address.trim() : "";
	if (!address) {
		throw new Error('read/write requires a non-empty "address" (e.g. "A1:B3")');
	}
	return address;
}

/** Read `arguments.name` as a non-empty identifier (table / named-range name), or throw. */
function requireName(args: Record<string, unknown>): string {
	const name = typeof args.name === "string" ? args.name.trim() : "";
	if (!name) {
		throw new Error('this tool requires a non-empty "name"');
	}
	return name;
}

// Leading characters Excel treats as the start of a formula. A string cell
// beginning with one of these is a formula/CSV-injection vector — agent-relayed
// content could smuggle `=cmd|…` into the user's sheet.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Neutralize a single cell value for a `write_range`. These tools write literal
 * *values*, so any string that Excel would evaluate as a formula is prefixed
 * with an apostrophe (`'…`) — Excel's text marker — forcing literal text.
 * Non-strings (numbers, booleans, null) pass through untouched. Formula
 * authoring, if ever needed, belongs in a separate opt-in tool.
 */
function sanitizeCellValue(value: unknown): unknown {
	return typeof value === "string" && FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/**
 * Build the Excel host-tool registrations (definition + handler). Pass the
 * result to {@link HostToolDispatcher.register}, or use {@link registerExcelTools}.
 */
export function createExcelHostTools(excel: ExcelLike = getExcel()): HostToolRegistration[] {
	return [
		{
			definition: {
				name: "list_sheets",
				description:
					"List all worksheet (tab) names in the open workbook. " +
					"Call this FIRST to discover the workbook structure before reading specific sheets.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let names: string[];
				try {
					names = await excel.run(async ctx => {
						ctx.workbook.worksheets.load("items/name");
						await ctx.sync();
						return ctx.workbook.worksheets.items.map(ws => ws.name);
					});
				} catch (err) {
					throw new Error(`list_sheets failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				return textResult(JSON.stringify(names), { sheets: names });
			},
		},
		{
			definition: {
				name: "read_range",
				description:
					"Read the cell values of a range. Supports sheet-qualified addresses " +
					'(e.g. "Sheet2!A1:B10" or "\'My Sheet\'!C1:D5") to read ANY worksheet, ' +
					'or a bare address (e.g. "A1:B3") to read the active sheet.',
				parameters: {
					type: "object",
					properties: {
						address: {
							type: "string",
							description: 'A1-style range address, optionally sheet-qualified: "A1:B3" or "Sheet2!A1:B10".',
						},
					},
					required: ["address"],
				},
			},
			handler: async args => {
				const raw = requireAddress(args);
				const { sheet, range: rangeAddr } = parseSheetAddress(raw);
				let values: unknown[][];
				try {
					values = await excel.run(async ctx => {
						const ws = resolveWorksheet(ctx.workbook.worksheets, sheet);
						const range = ws.getRange(rangeAddr);
						range.load("values");
						await ctx.sync();
						return range.values;
					});
				} catch (err) {
					throw new Error(describeExcelError("read_range", raw, err));
				}
				return textResult(JSON.stringify(values), { address: raw, values });
			},
		},
		{
			definition: {
				name: "write_range",
				description:
					"Write a 2D grid of literal values to a range. Supports sheet-qualified addresses " +
					'(e.g. "Sheet2!A1:B3") to write ANY worksheet, or a bare address for the active sheet. ' +
					"Values are written as text/numbers; strings that look like formulas are stored literally (not evaluated).",
				parameters: {
					type: "object",
					properties: {
						address: {
							type: "string",
							description: 'A1-style range address, optionally sheet-qualified: "A1:B3" or "Sheet2!A1:B10".',
						},
						values: {
							type: "array",
							description: "Rows of column values; its shape must match the address.",
							items: { type: "array" },
						},
					},
					required: ["address", "values"],
				},
			},
			handler: async args => {
				const raw = requireAddress(args);
				const { sheet, range: rangeAddr } = parseSheetAddress(raw);
				if (!Array.isArray(args.values)) {
					throw new Error('write_range requires "values" as a 2D array (rows of columns)');
				}
				// Neutralize formula/CSV-injection before the values ever reach the sheet.
				const values = (args.values as unknown[][]).map(row =>
					Array.isArray(row) ? row.map(sanitizeCellValue) : row,
				);
				try {
					await excel.run(async ctx => {
						const ws = resolveWorksheet(ctx.workbook.worksheets, sheet);
						const range = ws.getRange(rangeAddr);
						range.values = values;
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describeExcelError("write_range", raw, err));
				}
				return textResult(`Wrote ${values.length} row(s) to ${raw}.`, { address: raw });
			},
		},
		{
			definition: {
				name: "get_workbook_info",
				description:
					"Discover the full structure of the open workbook: every worksheet with its used range, " +
					"Excel Tables, and sheet-scoped named ranges, plus the workbook-level named ranges. " +
					"Call this FIRST to orient yourself before answering a workbook question.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let info: {
					sheets: { name: string; usedRange: string; tables: string[]; namedRanges: string[] }[];
					workbookNamedRanges: string[];
				};
				try {
					info = await excel.run(async ctx => {
						const worksheets = ctx.workbook.worksheets;
						worksheets.load("items/name");
						ctx.workbook.names.load("items/name");
						await ctx.sync();
						// Queue each sheet's used range, tables, and sheet-scoped names.
						const staged = worksheets.items.map(ws => {
							const used = ws.getUsedRange();
							used.load("address");
							const tables = ws.getTables();
							tables.load("items/name");
							ws.names.load("items/name");
							return { ws, used, tables };
						});
						await ctx.sync();
						return {
							sheets: staged.map(({ ws, used, tables }) => ({
								name: ws.name,
								usedRange: used.address ?? "",
								tables: tables.items.map(t => t.name),
								namedRanges: ws.names.items.map(n => n.name),
							})),
							workbookNamedRanges: ctx.workbook.names.items.map(n => n.name),
						};
					});
				} catch (err) {
					throw new Error(`get_workbook_info failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				return textResult(JSON.stringify(info), info);
			},
		},
		{
			definition: {
				name: "get_formulas",
				description:
					"Read the FORMULAS (not the computed values) of a range. Supports sheet-qualified addresses " +
					'(e.g. "Sheet2!A1:B10") or a bare address for the active sheet. Use this to inspect how ' +
					"cells are calculated before changing them.",
				parameters: {
					type: "object",
					properties: {
						address: {
							type: "string",
							description: 'A1-style range address, optionally sheet-qualified: "A1:B3" or "Sheet2!A1:B10".',
						},
					},
					required: ["address"],
				},
			},
			handler: async args => {
				const raw = requireAddress(args);
				const { sheet, range: rangeAddr } = parseSheetAddress(raw);
				let formulas: unknown[][];
				try {
					formulas = await excel.run(async ctx => {
						const ws = resolveWorksheet(ctx.workbook.worksheets, sheet);
						const range = ws.getRange(rangeAddr);
						range.load("formulas");
						await ctx.sync();
						return range.formulas;
					});
				} catch (err) {
					throw new Error(describeExcelError("get_formulas", raw, err));
				}
				return textResult(JSON.stringify(formulas), { address: raw, formulas });
			},
		},
		{
			definition: {
				name: "read_table",
				description:
					"Read the data of a named Excel Table (structured table), returning its body values, " +
					"column names, and address. Prefer this over read_range for Tables — it tracks the table's " +
					"real extent as rows are added or removed.",
				parameters: {
					type: "object",
					properties: {
						name: { type: "string", description: 'The Excel Table name (e.g. "Table1").' },
					},
					required: ["name"],
				},
			},
			handler: async args => {
				const name = requireName(args);
				let data: { values: unknown[][]; address: string; columns: string[] };
				try {
					data = await excel.run(async ctx => {
						const table = ctx.workbook.tables.getItem(name);
						const range = table.getRange();
						range.load("values,address");
						table.columns.load("items/name");
						await ctx.sync();
						return {
							values: range.values,
							address: range.address ?? "",
							columns: table.columns.items.map(c => c.name),
						};
					});
				} catch (err) {
					throw new Error(describeExcelError("read_table", name, err));
				}
				return textResult(JSON.stringify(data.values), { name, ...data });
			},
		},
		{
			definition: {
				name: "get_cell_metadata",
				description:
					"Read the number formats and value types of a range (e.g. which cells are currency, dates, " +
					"percentages, text, or errors). Supports sheet-qualified addresses or a bare address for the " +
					"active sheet. Use this to understand how data is typed and displayed.",
				parameters: {
					type: "object",
					properties: {
						address: {
							type: "string",
							description: 'A1-style range address, optionally sheet-qualified: "A1:B3" or "Sheet2!A1:B10".',
						},
					},
					required: ["address"],
				},
			},
			handler: async args => {
				const raw = requireAddress(args);
				const { sheet, range: rangeAddr } = parseSheetAddress(raw);
				let metadata: { numberFormat: string[][]; valueTypes: unknown[][] };
				try {
					metadata = await excel.run(async ctx => {
						const ws = resolveWorksheet(ctx.workbook.worksheets, sheet);
						const range = ws.getRange(rangeAddr);
						range.load("numberFormat,valueTypes");
						await ctx.sync();
						return { numberFormat: range.numberFormat, valueTypes: range.valueTypes };
					});
				} catch (err) {
					throw new Error(describeExcelError("get_cell_metadata", raw, err));
				}
				return textResult(JSON.stringify(metadata), { address: raw, ...metadata });
			},
		},
		{
			definition: {
				name: "read_named_range",
				description:
					"Read the values of a defined name (named range) by its name. Resolves the name to its " +
					"range anywhere in the workbook and returns the values and address.",
				parameters: {
					type: "object",
					properties: {
						name: { type: "string", description: 'The defined name / named range (e.g. "my_range").' },
					},
					required: ["name"],
				},
			},
			handler: async args => {
				const name = requireName(args);
				let data: { values: unknown[][]; address: string };
				try {
					data = await excel.run(async ctx => {
						const range = ctx.workbook.names.getItem(name).getRange();
						range.load("values,address");
						await ctx.sync();
						return { values: range.values, address: range.address ?? "" };
					});
				} catch (err) {
					throw new Error(describeExcelError("read_named_range", name, err));
				}
				return textResult(JSON.stringify(data.values), { name, ...data });
			},
		},
		{
			definition: {
				name: "sort_filter_table",
				description:
					"Sort and/or filter a named Excel Table by column. Provide sortColumn to sort (sortAscending " +
					"defaults to true), and/or filterColumn + filterValues to show only rows whose column matches " +
					"one of the values. At least one of sortColumn or filterColumn is required.",
				parameters: {
					type: "object",
					properties: {
						name: { type: "string", description: "The Excel Table name." },
						sortColumn: { type: "string", description: "Column name to sort by." },
						sortAscending: {
							type: "boolean",
							description: "Sort direction; true (ascending) by default.",
						},
						filterColumn: { type: "string", description: "Column name to filter." },
						filterValues: {
							type: "array",
							description: "Values to keep visible in filterColumn.",
							items: { type: "string" },
						},
					},
					required: ["name"],
				},
			},
			handler: async args => {
				const name = requireName(args);
				const sortColumn = typeof args.sortColumn === "string" ? args.sortColumn.trim() : "";
				const sortAscending = typeof args.sortAscending === "boolean" ? args.sortAscending : true;
				const filterColumn = typeof args.filterColumn === "string" ? args.filterColumn.trim() : "";
				const filterValues = Array.isArray(args.filterValues)
					? args.filterValues.filter((v): v is string => typeof v === "string")
					: [];
				if (!sortColumn && !filterColumn) {
					throw new Error('sort_filter_table requires "sortColumn" and/or "filterColumn"');
				}
				const applied: string[] = [];
				try {
					await excel.run(async ctx => {
						const table = ctx.workbook.tables.getItem(name);
						if (sortColumn) {
							table.columns.load("items/name");
							await ctx.sync();
							const key = table.columns.items.findIndex(c => c.name === sortColumn);
							if (key < 0) {
								throw new Error(`column "${sortColumn}" not found in table "${name}"`);
							}
							table.sort.apply([{ key, ascending: sortAscending }]);
							applied.push(`sorted by ${sortColumn} ${sortAscending ? "ascending" : "descending"}`);
						}
						if (filterColumn) {
							table.columns.getItem(filterColumn).filter.apply({ filterOn: "Values", values: filterValues });
							applied.push(`filtered ${filterColumn} to ${filterValues.length} value(s)`);
						}
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describeExcelError("sort_filter_table", name, err));
				}
				return textResult(`Table ${name}: ${applied.join("; ")}.`, { name, applied });
			},
		},
	];
}

/** Register the Excel host tools with a dispatcher (advertises via set_host_tools). */
export function registerExcelTools(
	dispatcher: { register(tools: HostToolRegistration[]): void },
	excel: ExcelLike = getExcel(),
): void {
	dispatcher.register(createExcelHostTools(excel));
}

/**
 * Wire the Excel host tools onto a transport for the running add-in.
 *
 * Constructs the {@link HostToolDispatcher} immediately (it subscribes to the
 * transport so inbound `host_tool_call`s are serviced) and returns an
 * `onConnected` callback that advertises the tools via `set_host_tools`. The
 * callback MUST run only after the transport is open (registration sends on the
 * socket) — pass it to `ChatPanel`'s `onConnected` prop. Returns both the
 * callback and the dispatcher (so callers can `dispose()` on teardown).
 */
export function wireExcelHostTools(
	transport: Transport,
	excel: ExcelLike = getExcel(),
): { onConnected: () => void; dispatcher: HostToolDispatcher } {
	const dispatcher = new HostToolDispatcher(transport);
	return {
		dispatcher,
		onConnected: () => registerExcelTools(dispatcher, excel),
	};
}
