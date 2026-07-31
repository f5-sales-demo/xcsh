/**
 * Office.js Excel document tools registered through the host-tool dispatcher.
 *
 * The agent drives these tools over the WS host-tool channel: the client
 * advertises them via `set_host_tools`, then answers each `host_tool_call` with
 * an `AgentToolResult` (a `content[]` array). Here we inject an `ExcelLike` fake
 * (the `Excel.run` seam) so the tools are unit-testable with no Office runtime.
 */
import { describe, expect, it } from "bun:test";
import {
	type AgentToolResult,
	HostToolDispatcher,
	type HostToolResultMsg,
	MockTransport,
	type SetHostToolsMsg,
} from "../src/core";
import {
	createExcelHostTools,
	type ExcelLike,
	registerExcelTools,
	wireExcelHostTools,
} from "../src/office/excel-tools";

/**
 * A minimal in-memory `Excel.run` fake backed by a single active sheet's
 * address→values map. Mirrors the load/sync gating of real Office.js: reads
 * return whatever was seeded; writes mutate the store.
 */
/**
 * Structural metadata for the {@link fakeExcel} mock — the higher-order surfaces
 * (#2212 depth tools) the flat address→values store can't express: per-sheet
 * used ranges, tables and named ranges; workbook-level named ranges and tables;
 * and per-address formulas / number formats / value types.
 */
interface FakeExcelMeta {
	/** Per-sheet structural info keyed by tab name. */
	sheetMeta?: Record<
		string,
		{
			usedRange?: string;
			/** Table names living on this sheet. */
			tables?: string[];
			/** Sheet-scoped named range names. */
			names?: string[];
			/** address → 2D formula grid. */
			formulas?: Record<string, unknown[][]>;
			/** address → 2D number-format grid. */
			numberFormat?: Record<string, string[][]>;
			/** address → 2D value-type grid. */
			valueTypes?: Record<string, unknown[][]>;
		}
	>;
	/** Workbook-level named ranges: name → { address, values }. */
	namedRanges?: Record<string, { address: string; values: unknown[][]; notRange?: boolean }>;
	/** Workbook-level tables: name → { address, values, columns }. */
	tables?: Record<string, { address: string; values: unknown[][]; columns?: string[] }>;
}

/** A captured `sort.apply` / `filter.apply` invocation (for sort_filter_table assertions). */
interface FakeExcelOps {
	sorts: { table: string; fields: { key: number; ascending: boolean }[] }[];
	filters: { table: string; column: string; criteria: { filterOn: string; values: string[] } }[];
}

/**
 * A multi-sheet `Excel.run` fake. Each key in `sheets` is a tab name whose value
 * is `{ address: values }`. The first key is the "active" sheet. `cells` tracks
 * the address→values store for the active sheet (backward compat with existing tests).
 * The optional `meta` argument layers on the higher-order structural surfaces
 * (tables, named ranges, formulas, cell metadata) the depth tools read; `ops`
 * records the sort/filter calls those tools make.
 */
function fakeExcel(
	seed: Record<string, unknown[][]> = {},
	sheets?: Record<string, Record<string, unknown[][]>>,
	meta: FakeExcelMeta = {},
): ExcelLike & {
	cells: Record<string, unknown[][]>;
	ops: FakeExcelOps;
	/** Tab names currently in the fake workbook, in creation order. */
	sheetNames(): string[];
	/** The address→values store for one sheet (asserting cross-sheet writes). */
	sheetCells(name: string): Record<string, unknown[][]>;
} {
	// Backward compat: if `sheets` isn't provided, wrap seed as the sole "Sheet1".
	const sheetStore: Record<string, Record<string, unknown[][]>> = sheets ?? { Sheet1: { ...seed } };
	const sheetNames = Object.keys(sheetStore);
	const activeName = sheetNames[0] ?? "Sheet1";
	// `cells` aliases the active sheet's store (existing tests read/assert it).
	const cells = sheetStore[activeName] ?? {};
	const ops: FakeExcelOps = { sorts: [], filters: [] };
	const namedRanges = meta.namedRanges ?? {};
	const tables = meta.tables ?? {};

	// A range whose loaded facets read from the given per-address maps.
	const makeRange = (
		address: string,
		opts: {
			read?: () => unknown[][];
			write?: (v: unknown[][]) => void;
			formulas?: unknown[][];
			numberFormat?: string[][];
			valueTypes?: unknown[][];
		} = {},
	) => ({
		address,
		get values(): unknown[][] {
			return opts.read?.() ?? [];
		},
		set values(v: unknown[][]) {
			opts.write?.(v);
		},
		formulas: opts.formulas ?? [],
		numberFormat: opts.numberFormat ?? [],
		valueTypes: opts.valueTypes ?? [],
		load(_props: string): void {
			/* fake resolves lazily via the getters above */
		},
	});

	return {
		cells,
		ops,
		sheetNames: () => Object.keys(sheetStore),
		sheetCells: (name: string) => sheetStore[name] ?? {},
		run: async <T>(batch: (ctx: never) => Promise<T>): Promise<T> => {
			const makeSheet = (name: string) => {
				const store = sheetStore[name];
				if (!store) throw new Error(`Sheet "${name}" not found`);
				const sm = meta.sheetMeta?.[name] ?? {};
				return {
					name,
					getRange: (address: string) =>
						makeRange(address, {
							read: () => store[address] ?? [],
							write: v => {
								store[address] = v;
								if (name === activeName) cells[address] = v;
							},
							formulas: sm.formulas?.[address],
							numberFormat: sm.numberFormat?.[address],
							valueTypes: sm.valueTypes?.[address],
						}),
					getUsedRangeOrNullObject: () => makeRange(sm.usedRange ?? "", { read: () => [] }),
					// Office.js Worksheet.tables is a PROPERTY (not a getTables() method).
					tables: {
						items: (sm.tables ?? []).map(n => ({ name: n })),
						load(_props: string): void {},
					},
					names: {
						items: (sm.names ?? []).map(n => ({ name: n })),
						load(_props: string): void {},
					},
				};
			};
			const makeTable = (name: string) => {
				const t = tables[name];
				if (!t) throw new Error(`Table "${name}" not found`);
				const cols = t.columns ?? [];
				return {
					name,
					getDataBodyRange: () => makeRange(t.address, { read: () => t.values }),
					columns: {
						items: cols.map(c => ({ name: c })),
						load(_props: string): void {},
						getItem: (col: string) => ({
							name: col,
							index: cols.indexOf(col),
							filter: {
								apply(criteria: { filterOn: string; values: string[] }): void {
									ops.filters.push({ table: name, column: col, criteria });
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
			const ctx = {
				workbook: {
					worksheets: {
						getActiveWorksheet: () => makeSheet(activeName),
						getItem: (name: string) => makeSheet(name),
						// Office.js resolves a missing sheet to a null object rather than
						// throwing, but only after the `isNullObject` load is synced.
						getItemOrNullObject: (name: string) => ({
							isNullObject: !(name in sheetStore),
							load(_props: string): void {
								/* isNullObject is already resolved above */
							},
						}),
						add: (name: string) => {
							if (name in sheetStore) throw new Error(`ItemAlreadyExists: ${name}`);
							sheetStore[name] = {};
							return makeSheet(name);
						},
						items: sheetNames.map(n => makeSheet(n)),
						load(_props: string): void {
							/* items already populated */
						},
					},
					names: {
						items: Object.keys(namedRanges).map(n => ({ name: n })),
						load(_props: string): void {},
						getItem: (name: string) => {
							const nr = namedRanges[name];
							if (!nr) throw new Error(`Named range "${name}" not found`);
							// getRangeOrNullObject: a non-range defined name resolves to a null object
							// (isNullObject:true) rather than throwing — mirrors real Office.js.
							return {
								getRangeOrNullObject: () =>
									Object.assign(makeRange(nr.address, { read: () => nr.values }), {
										isNullObject: nr.notRange ?? false,
									}),
							};
						},
					},
					tables: {
						getItem: (name: string) => makeTable(name),
					},
				},
				sync: async (): Promise<void> => {},
			};
			return batch(ctx as never);
		},
	};
}

function callFrom(t: MockTransport): HostToolResultMsg | undefined {
	return t.sent.find(m => m.type === "host_tool_result") as HostToolResultMsg | undefined;
}

/** First content block's text (the native content union is TextContent | ImageContent). */
function firstText(reply?: HostToolResultMsg): string | undefined {
	const c = reply?.result.content[0];
	return c && c.type === "text" ? c.text : undefined;
}

/** Drain the microtask queue (settles the async handler → excel.run → sync chain). */
function flush(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

describe("excel-tools", () => {
	const ALL_TOOL_NAMES = [
		"add_sheet",
		"get_cell_metadata",
		"get_formulas",
		"get_workbook_info",
		"list_sheets",
		"read_named_range",
		"read_range",
		"read_table",
		"sort_filter_table",
		"write_cells",
		"write_range",
	];

	it("createExcelHostTools advertises the full Excel tool set with JSON-schema params", () => {
		const tools = createExcelHostTools(fakeExcel());
		const names = tools.map(t => t.definition.name).sort();
		expect(names).toEqual(ALL_TOOL_NAMES);
		for (const t of tools) {
			expect(t.definition.parameters).toMatchObject({ type: "object" });
		}
	});

	it("registerExcelTools pushes every tool to the agent via set_host_tools", () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel());

		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		expect(frame).toBeDefined();
		expect(frame?.tools.map(x => x.name).sort()).toEqual(ALL_TOOL_NAMES);
		d.dispose();
	});

	it("a read_range host_tool_call returns the sheet values as a content[] result", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(
			d,
			fakeExcel({
				"A1:B2": [
					[1, 2],
					[3, 4],
				],
			}),
		);

		t.emit({
			type: "host_tool_call",
			id: "ht-1",
			toolCallId: "tc-1",
			toolName: "read_range",
			arguments: { address: "A1:B2" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.id).toBe("ht-1");
		expect(reply?.isError).toBeUndefined();
		expect(Array.isArray(reply?.result.content)).toBe(true);
		const text = firstText(reply) ?? "";
		expect(text).toContain("1");
		expect(text).toContain("4");
		// Structured values preserved in details for the panel/agent.
		const structured = reply?.result as AgentToolResult<{ values: unknown[][] }> | undefined;
		expect(structured?.details?.values).toEqual([
			[1, 2],
			[3, 4],
		]);
		d.dispose();
	});

	it("a write_range host_tool_call mutates the sheet and confirms with a content[] result", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel();
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "ht-2",
			toolCallId: "tc-2",
			toolName: "write_range",
			arguments: { address: "C1:C2", values: [["x"], ["y"]] },
		});
		await flush();

		expect(excel.cells["C1:C2"]).toEqual([["x"], ["y"]]);
		const reply = callFrom(t);
		expect(reply?.id).toBe("ht-2");
		expect(reply?.isError).toBeUndefined();
		expect(firstText(reply)).toContain("C1:C2");
		d.dispose();
	});

	it("write_range neutralizes formula/CSV-injection strings but leaves safe values intact", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel();
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "ht-4",
			toolCallId: "tc-4",
			toolName: "write_range",
			arguments: {
				address: "A1:A6",
				values: [["=SUM(A1:A2)"], ["+1"], ["-2+3"], ["@evil"], ["safe text"], [42]],
			},
		});
		await flush();

		// Leading formula triggers are prefixed with an apostrophe → stored as text.
		expect(excel.cells["A1:A6"]).toEqual([[`'=SUM(A1:A2)`], [`'+1`], [`'-2+3`], [`'@evil`], ["safe text"], [42]]);
		const reply = callFrom(t);
		expect(reply?.id).toBe("ht-4");
		expect(reply?.isError).toBeUndefined();
		d.dispose();
	});

	it("wireExcelHostTools advertises tools only after connect and then services a host_tool_call", async () => {
		const t = new MockTransport();
		const excel = fakeExcel({ "A1:B1": [["x", "y"]] });
		const { onConnected, dispatcher } = wireExcelHostTools(t, excel);

		// Dispatcher is constructed (subscribed) but nothing advertised until connect.
		expect(t.sent.some(m => m.type === "set_host_tools")).toBe(false);

		onConnected(); // simulates ChatPanel's post-connect hook
		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		// ALL_TOOL_NAMES, not a second copy of it: this list was duplicated here and went
		// stale the moment a tool was added.
		expect(frame?.tools.map(x => x.name).sort()).toEqual(ALL_TOOL_NAMES);

		// A host_tool_call is serviced end-to-end.
		t.emit({
			type: "host_tool_call",
			id: "ht-9",
			toolCallId: "tc-9",
			toolName: "read_range",
			arguments: { address: "A1:B1" },
		});
		await flush();
		const reply = callFrom(t);
		expect(reply?.id).toBe("ht-9");
		expect(reply?.isError).toBeUndefined();
		expect(firstText(reply)).toContain("x");
		dispatcher.dispose();
	});

	it("read_range surfaces the Office error code + debugInfo when Excel.run fails", async () => {
		const t = new MockTransport();
		const failingExcel: ExcelLike = {
			run: async () => {
				throw {
					code: "InvalidOperation",
					message: "You cannot perform the requested operation.",
					debugInfo: { errorLocation: "Worksheet.getRange" },
				};
			},
		};
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, failingExcel);

		t.emit({
			type: "host_tool_call",
			id: "ht-e",
			toolCallId: "tc-e",
			toolName: "read_range",
			arguments: { address: "D3:G8" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		const txt = firstText(reply) ?? "";
		expect(txt).toContain("read_range(D3:G8)");
		expect(txt).toContain("InvalidOperation");
		expect(txt).toContain("errorLocation");
		d.dispose();
	});

	it("read_range with a missing address argument answers with an isError result (never hangs)", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel());

		t.emit({ type: "host_tool_call", id: "ht-3", toolCallId: "tc-3", toolName: "read_range", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.id).toBe("ht-3");
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("address");
		d.dispose();
	});
});

// ---------------------------------------------------------------------------
// Multi-sheet (#2212)
// ---------------------------------------------------------------------------

import { parseSheetAddress } from "../src/office/excel-tools";

const dummyCtx = { signal: AbortSignal.timeout(5000), toolCallId: "test" } as import("../src/core").HostToolContext;

describe("multi-sheet support (#2212)", () => {
	it("list_sheets returns all worksheet tab names", async () => {
		const excel = fakeExcel(
			{},
			{
				"Performance Datasheet": { "A1:B1": [["RPS", 31613]] },
				"Environment-Details": { "A1:B1": [["Platform", "AWS"]] },
			},
		);
		const tools = createExcelHostTools(excel);
		const listSheets = tools.find(t => t.definition.name === "list_sheets");
		expect(listSheets).toBeDefined();
		const result = await listSheets!.handler({}, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual(["Performance Datasheet", "Environment-Details"]);
	});

	it("read_range with a sheet-qualified address reads THAT sheet, not the active one", async () => {
		const excel = fakeExcel(
			{},
			{
				Sheet1: { "A1:B1": [["active", "data"]] },
				"Environment-Details": { "A1:B1": [["Platform", "AWS"]] },
			},
		);
		const tools = createExcelHostTools(excel);
		const readRange = tools.find(t => t.definition.name === "read_range")!;
		// Sheet-qualified: reads Environment-Details, not the active Sheet1.
		const result = await readRange.handler({ address: "Environment-Details!A1:B1" }, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual([["Platform", "AWS"]]);
	});

	it("read_range with a quoted sheet name works ('My Sheet'!A1:B1)", async () => {
		const excel = fakeExcel(
			{},
			{
				Sheet1: {},
				"My Sheet": { "A1:B1": [["quoted", "access"]] },
			},
		);
		const tools = createExcelHostTools(excel);
		const result = await tools
			.find(t => t.definition.name === "read_range")!
			.handler({ address: "'My Sheet'!A1:B1" }, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual([["quoted", "access"]]);
	});

	it("read_range with a bare address (no sheet prefix) still reads the active sheet", async () => {
		const excel = fakeExcel(
			{},
			{
				Active: { "A1:A1": [[42]] },
				Other: { "A1:A1": [[99]] },
			},
		);
		const tools = createExcelHostTools(excel);
		const result = await tools.find(t => t.definition.name === "read_range")!.handler({ address: "A1:A1" }, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual([[42]]);
	});

	it("write_range with a sheet-qualified address writes THAT sheet", async () => {
		const excel = fakeExcel(
			{},
			{
				Sheet1: {},
				Sheet2: {},
			},
		);
		const tools = createExcelHostTools(excel);
		await tools
			.find(t => t.definition.name === "write_range")!
			.handler(
				{
					address: "Sheet2!A1:B1",
					values: [["hello", "world"]],
				},
				dummyCtx,
			);
		// Read it back from Sheet2 to confirm.
		const result = await tools
			.find(t => t.definition.name === "read_range")!
			.handler({ address: "Sheet2!A1:B1" }, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual([["hello", "world"]]);
	});
});

// ---------------------------------------------------------------------------
// Phase 0 — get_workbook_info (prefetch) + Phase 1 — Excel depth tools (#2212)
// ---------------------------------------------------------------------------

/** Resolve a tool's handler by name (throws if the tool isn't registered → RED). */
function tool(excel: ExcelLike, name: string) {
	const found = createExcelHostTools(excel).find(t => t.definition.name === name);
	if (!found) throw new Error(`tool "${name}" is not registered`);
	return found;
}

/** Parse a handler's first text content block as JSON. */
async function callJson(excel: ExcelLike, name: string, args: Record<string, unknown>): Promise<unknown> {
	const result = await tool(excel, name).handler(args, dummyCtx);
	const text = result.content[0].type === "text" ? result.content[0].text : "";
	return JSON.parse(text);
}

describe("get_workbook_info (Phase 0 prefetch)", () => {
	it("returns per-sheet used ranges, tables, named ranges, and workbook-level named ranges", async () => {
		const excel = fakeExcel(
			{},
			{
				Sheet1: { "A1:B1": [["x", "y"]] },
				Data: { "A1:A1": [[1]] },
			},
			{
				sheetMeta: {
					Sheet1: { usedRange: "A1:Z22", tables: ["Table1"], names: ["sheet_local"] },
					Data: { usedRange: "A1:C9", tables: [], names: [] },
				},
				namedRanges: { global_name: { address: "Sheet1!A1:B1", values: [["x", "y"]] } },
			},
		);
		const info = (await callJson(excel, "get_workbook_info", {})) as {
			sheets: { name: string; usedRange: string; tables: string[]; namedRanges: string[] }[];
			workbookNamedRanges: string[];
		};
		expect(info.sheets).toEqual([
			{ name: "Sheet1", usedRange: "A1:Z22", tables: ["Table1"], namedRanges: ["sheet_local"] },
			{ name: "Data", usedRange: "A1:C9", tables: [], namedRanges: [] },
		]);
		expect(info.workbookNamedRanges).toEqual(["global_name"]);
	});

	it("carries the structure in details for the panel/agent", async () => {
		const excel = fakeExcel({}, { Sheet1: {} }, { sheetMeta: { Sheet1: { usedRange: "A1:A1" } } });
		const result = await tool(excel, "get_workbook_info").handler({}, dummyCtx);
		const details = result.details as { sheets: unknown[]; workbookNamedRanges: unknown[] } | undefined;
		expect(details?.sheets.length).toBe(1);
		expect(Array.isArray(details?.workbookNamedRanges)).toBe(true);
	});
});

describe("get_formulas (Phase 1)", () => {
	it("reads the formulas (not values) of a range", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: { "A1:A2": [[3], [7]] } },
			{ sheetMeta: { Sheet1: { formulas: { "A1:A2": [["=1+2"], ["=SUM(A1)"]] } } } },
		);
		const formulas = await callJson(excel, "get_formulas", { address: "A1:A2" });
		expect(formulas).toEqual([["=1+2"], ["=SUM(A1)"]]);
	});

	it("honors a sheet-qualified address", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {}, Calc: {} },
			{ sheetMeta: { Calc: { formulas: { "B2:B2": [["=A2*2"]] } } } },
		);
		const formulas = await callJson(excel, "get_formulas", { address: "Calc!B2:B2" });
		expect(formulas).toEqual([["=A2*2"]]);
	});

	it("throws (dispatcher → isError) on a missing address", async () => {
		const excel = fakeExcel();
		expect(tool(excel, "get_formulas").handler({}, dummyCtx)).rejects.toThrow(/address/i);
	});
});

describe("read_table (Phase 1)", () => {
	it("reads a named Excel Table's data and columns", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{
				tables: {
					Sales: {
						address: "Sheet1!A1:B3",
						values: [
							["Region", "Total"],
							["East", 10],
							["West", 20],
						],
						columns: ["Region", "Total"],
					},
				},
			},
		);
		const result = await tool(excel, "read_table").handler({ name: "Sales" }, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual([
			["Region", "Total"],
			["East", 10],
			["West", 20],
		]);
		const details = result.details as { name: string; address: string; columns: string[] } | undefined;
		expect(details?.name).toBe("Sales");
		expect(details?.address).toBe("Sheet1!A1:B3");
		expect(details?.columns).toEqual(["Region", "Total"]);
	});

	it("throws (dispatcher → isError) on a missing name", async () => {
		const excel = fakeExcel();
		expect(tool(excel, "read_table").handler({}, dummyCtx)).rejects.toThrow(/name/i);
	});
});

describe("get_cell_metadata (Phase 1)", () => {
	it("reads numberFormat and valueTypes for a range", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: { "A1:B1": [[1, "txt"]] } },
			{
				sheetMeta: {
					Sheet1: {
						numberFormat: { "A1:B1": [["0.00", "General"]] },
						valueTypes: { "A1:B1": [["Double", "String"]] },
					},
				},
			},
		);
		const meta = (await callJson(excel, "get_cell_metadata", { address: "A1:B1" })) as {
			numberFormat: string[][];
			valueTypes: unknown[][];
		};
		expect(meta.numberFormat).toEqual([["0.00", "General"]]);
		expect(meta.valueTypes).toEqual([["Double", "String"]]);
	});
});

describe("read_named_range (Phase 1)", () => {
	it("reads a named range by its defined name", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{ namedRanges: { my_range: { address: "Sheet1!C1:C2", values: [[42], [43]] } } },
		);
		const result = await tool(excel, "read_named_range").handler({ name: "my_range" }, dummyCtx);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(JSON.parse(text)).toEqual([[42], [43]]);
		const details = result.details as { name: string; address: string } | undefined;
		expect(details?.address).toBe("Sheet1!C1:C2");
	});

	it("throws (dispatcher → isError) on a missing name", async () => {
		const excel = fakeExcel();
		expect(tool(excel, "read_named_range").handler({}, dummyCtx)).rejects.toThrow(/name/i);
	});

	it("reports a clear error when the defined name is NOT a cell range (getRangeOrNullObject → isNullObject)", async () => {
		// A defined name pointing at a constant/formula resolves to a null object, not a range.
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{ namedRanges: { tax_rate: { address: "", values: [], notRange: true } } },
		);
		expect(tool(excel, "read_named_range").handler({ name: "tax_rate" }, dummyCtx)).rejects.toThrow(
			/not a cell range/i,
		);
	});
});

describe("sort_filter_table (Phase 1)", () => {
	it("sorts a table by a named column, resolving the column index", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{ tables: { T: { address: "A1:B3", values: [], columns: ["Name", "Score"] } } },
		);
		await tool(excel, "sort_filter_table").handler(
			{ name: "T", sortColumn: "Score", sortAscending: false },
			dummyCtx,
		);
		expect(excel.ops.sorts).toEqual([{ table: "T", fields: [{ key: 1, ascending: false }] }]);
	});

	it("defaults sort to ascending", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{ tables: { T: { address: "A1:B3", values: [], columns: ["Name", "Score"] } } },
		);
		await tool(excel, "sort_filter_table").handler({ name: "T", sortColumn: "Name" }, dummyCtx);
		expect(excel.ops.sorts).toEqual([{ table: "T", fields: [{ key: 0, ascending: true }] }]);
	});

	it("filters a table column by values", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{ tables: { T: { address: "A1:B3", values: [], columns: ["Region", "Score"] } } },
		);
		await tool(excel, "sort_filter_table").handler(
			{ name: "T", filterColumn: "Region", filterValues: ["East", "West"] },
			dummyCtx,
		);
		expect(excel.ops.filters).toEqual([
			{ table: "T", column: "Region", criteria: { filterOn: "Values", values: ["East", "West"] } },
		]);
	});

	it("throws when neither a sort nor a filter is requested", async () => {
		const excel = fakeExcel(
			{},
			{ Sheet1: {} },
			{ tables: { T: { address: "A1:B3", values: [], columns: ["Region"] } } },
		);
		expect(tool(excel, "sort_filter_table").handler({ name: "T" }, dummyCtx)).rejects.toThrow(
			/sortColumn|filterColumn/i,
		);
	});
});

describe("parseSheetAddress", () => {
	it("parses a bare address as active-sheet", () => {
		expect(parseSheetAddress("A1:B3")).toEqual({ sheet: null, range: "A1:B3" });
	});
	it("parses an unquoted sheet prefix", () => {
		expect(parseSheetAddress("Sheet2!A1:B10")).toEqual({ sheet: "Sheet2", range: "A1:B10" });
	});
	it("parses a quoted sheet prefix with spaces", () => {
		expect(parseSheetAddress("'My Sheet'!C1:D5")).toEqual({ sheet: "My Sheet", range: "C1:D5" });
	});
	it("handles dotted/numeric sheet names", () => {
		expect(parseSheetAddress("Data.2024!A1:Z100")).toEqual({ sheet: "Data.2024", range: "A1:Z100" });
	});
});

describe("add_sheet", () => {
	it("creates a worksheet that does not exist yet", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "as-1",
			toolCallId: "tc-as-1",
			toolName: "add_sheet",
			arguments: { name: "MEDDPICC — Example Corp" },
		});
		await flush();

		expect(excel.sheetNames()).toContain("MEDDPICC — Example Corp");
		expect(firstText(callFrom(t))).toContain("Created");
		d.dispose();
	});

	it("is idempotent — re-rendering a deal reuses the sheet instead of adding a second one", async () => {
		// Office.js `worksheets.add` throws ItemAlreadyExists on a duplicate name, which
		// would abort a re-render halfway. A second call must be a no-op, so the caller
		// can always add-then-write.
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {}, Report: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "as-2",
			toolCallId: "tc-as-2",
			toolName: "add_sheet",
			arguments: { name: "Report" },
		});
		await flush();

		expect(excel.sheetNames().filter(n => n === "Report")).toHaveLength(1);
		expect(firstText(callFrom(t))).toContain("already exists");
		d.dispose();
	});

	it("rejects a name Excel cannot accept rather than letting Office.js fail opaquely", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel({}, { Sheet1: {} }));

		t.emit({
			type: "host_tool_call",
			id: "as-3",
			toolCallId: "tc-as-3",
			toolName: "add_sheet",
			arguments: { name: "a/b:c" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)).toContain(":");
		d.dispose();
	});

	it("rejects an over-long name (Excel's 31-character limit)", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel({}, { Sheet1: {} }));

		t.emit({
			type: "host_tool_call",
			id: "as-4",
			toolCallId: "tc-as-4",
			toolName: "add_sheet",
			arguments: { name: "x".repeat(32) },
		});
		await flush();

		expect(callFrom(t)?.isError).toBe(true);
		d.dispose();
	});

	it("rejects an empty name", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel({}, { Sheet1: {} }));

		t.emit({
			type: "host_tool_call",
			id: "as-5",
			toolCallId: "tc-as-5",
			toolName: "add_sheet",
			arguments: { name: "   " },
		});
		await flush();

		expect(callFrom(t)?.isError).toBe(true);
		d.dispose();
	});

	it("a newly added sheet is immediately writable by write_range", async () => {
		// The whole point: `add_sheet` then `write_range` per block, with no read-back.
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "as-6",
			toolCallId: "tc-as-6",
			toolName: "add_sheet",
			arguments: { name: "Deal" },
		});
		await flush();
		t.emit({
			type: "host_tool_call",
			id: "as-7",
			toolCallId: "tc-as-7",
			toolName: "write_range",
			arguments: { address: "Deal!A1:B1", values: [["Account Name", "Example Corp"]] },
		});
		await flush();

		expect(excel.sheetCells("Deal")["A1:B1"]).toEqual([["Account Name", "Example Corp"]]);
		d.dispose();
	});
});

/**
 * `write_cells` — many single cells in ONE Excel.run.
 *
 * Filling the F5 MEDDPICC template means writing ~117 individual anchors. As
 * `write_range` calls that is 117 round trips over the bridge, and the anchors cannot be
 * batched into ranges because each sits inside a merged area where only the top-left may
 * be written. So the batching has to happen tool-side.
 */
describe("write_cells", () => {
	it("writes every cell in the batch", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "wc-1",
			toolCallId: "tc-wc-1",
			toolName: "write_cells",
			arguments: {
				cells: [
					{ address: "C4", value: "Example Corp" },
					{ address: "N7", value: 473687 },
					{ address: "I5", value: 0.6 },
				],
			},
		});
		await flush();

		expect(excel.cells.C4).toEqual([["Example Corp"]]);
		expect(excel.cells.N7).toEqual([[473687]]);
		expect(excel.cells.I5).toEqual([[0.6]]);
		expect(firstText(callFrom(t))).toContain("3");
		d.dispose();
	});

	it("honours a sheet-qualified address", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {}, "MEDDPICC Deal Review Sheet": {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "wc-2",
			toolCallId: "tc-wc-2",
			toolName: "write_cells",
			arguments: { cells: [{ address: "'MEDDPICC Deal Review Sheet'!C4", value: "Example Corp" }] },
		});
		await flush();

		expect(excel.sheetCells("MEDDPICC Deal Review Sheet").C4).toEqual([["Example Corp"]]);
		d.dispose();
	});

	it("keeps numbers numeric — the template computes from them", async () => {
		// The sheet's Factored Pipe is =N4*I5. A currency coerced to "$473,687" breaks it.
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "wc-3",
			toolCallId: "tc-wc-3",
			toolName: "write_cells",
			arguments: { cells: [{ address: "N4", value: 1421060 }] },
		});
		await flush();

		expect(typeof (excel.cells.N4 as unknown[][])[0][0]).toBe("number");
		d.dispose();
	});

	it("neutralises a value Excel would execute as a formula", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "wc-4",
			toolCallId: "tc-wc-4",
			toolName: "write_cells",
			arguments: { cells: [{ address: "C4", value: "=cmd|/c calc" }] },
		});
		await flush();

		expect(String((excel.cells.C4 as unknown[][])[0][0]).startsWith("=")).toBe(false);
		d.dispose();
	});

	it("rejects a malformed batch instead of writing half of it", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		registerExcelTools(d, excel);

		t.emit({
			type: "host_tool_call",
			id: "wc-5",
			toolCallId: "tc-wc-5",
			toolName: "write_cells",
			arguments: { cells: [{ address: "C4", value: "ok" }, { value: "no address" }] },
		});
		await flush();

		expect(callFrom(t)?.isError).toBe(true);
		// Validation happens before any write, so the good cell must not have landed.
		expect(excel.cells.C4).toBeUndefined();
		d.dispose();
	});

	it("rejects an empty batch rather than reporting a silent success", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel({}, { Sheet1: {} }));

		t.emit({
			type: "host_tool_call",
			id: "wc-6",
			toolCallId: "tc-wc-6",
			toolName: "write_cells",
			arguments: { cells: [] },
		});
		await flush();

		expect(callFrom(t)?.isError).toBe(true);
		d.dispose();
	});

	it("a 117-cell batch is a SINGLE Excel.run", async () => {
		// The whole reason this tool exists. One batch, one sync, one round trip.
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const excel = fakeExcel({}, { Sheet1: {} });
		let runs = 0;
		const counting = {
			...excel,
			run: (b: Parameters<typeof excel.run>[0]) => {
				runs++;
				return excel.run(b);
			},
		};
		registerExcelTools(d, counting as typeof excel);

		const cells = Array.from({ length: 117 }, (_, i) => ({ address: `A${i + 1}`, value: i }));
		t.emit({
			type: "host_tool_call",
			id: "wc-7",
			toolCallId: "tc-wc-7",
			toolName: "write_cells",
			arguments: { cells },
		});
		await flush();

		expect(runs).toBe(1);
		expect(excel.cells.A117).toEqual([[116]]);
		d.dispose();
	});
});
