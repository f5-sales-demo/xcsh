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

/** A worksheet range — the subset of `Excel.Range` these tools touch. */
export interface ExcelRangeLike {
	/** 2D grid of cell values (rows of columns). */
	values: unknown[][];
	/** Queue a property (e.g. `"values"`) to load on the next `sync()`. */
	load(properties: string): void;
}

/** A single worksheet — the subset these tools touch. */
export interface ExcelWorksheetLike {
	/** The tab name shown in the Excel sheet tab bar. */
	name: string;
	getRange(address: string): ExcelRangeLike;
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
	workbook: { worksheets: ExcelWorksheetCollectionLike };
	/** Flush queued reads/writes to the document. */
	sync(): Promise<void>;
}

/**
 * Parse a potentially sheet-qualified A1 address. `Sheet2!A1:B3` → `{ sheet: "Sheet2", range: "A1:B3" }`.
 * A bare `A1:B3` → `{ sheet: null, range: "A1:B3" }` (active sheet).
 * Handles quoted sheet names: `'My Sheet'!A1` → sheet `My Sheet`.
 */
export function parseSheetAddress(input: string): { sheet: string | null; range: string } {
	// Quoted sheet name: 'Sheet Name'!A1:B3
	const quoted = input.match(/^'([^']+)'!(.+)$/);
	if (quoted) return { sheet: quoted[1], range: quoted[2] };
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
						ctx.workbook.worksheets.load("items");
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
