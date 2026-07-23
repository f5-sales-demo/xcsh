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
 * A multi-sheet `Excel.run` fake. Each key in `sheets` is a tab name whose value
 * is `{ address: values }`. The first key is the "active" sheet. `cells` tracks
 * the address→values store for the active sheet (backward compat with existing tests).
 */
function fakeExcel(
	seed: Record<string, unknown[][]> = {},
	sheets?: Record<string, Record<string, unknown[][]>>,
): ExcelLike & { cells: Record<string, unknown[][]> } {
	// Backward compat: if `sheets` isn't provided, wrap seed as the sole "Sheet1".
	const sheetStore: Record<string, Record<string, unknown[][]>> = sheets ?? { Sheet1: { ...seed } };
	const sheetNames = Object.keys(sheetStore);
	const activeName = sheetNames[0] ?? "Sheet1";
	// `cells` aliases the active sheet's store (existing tests read/assert it).
	const cells = sheetStore[activeName] ?? {};

	return {
		cells,
		run: async <T>(batch: (ctx: never) => Promise<T>): Promise<T> => {
			const makeSheet = (name: string) => {
				const store = sheetStore[name];
				if (!store) throw new Error(`Sheet "${name}" not found`);
				return {
					name,
					getRange: (address: string) => {
						let pendingRead: { values: unknown[][] } | null = null;
						return {
							get values(): unknown[][] {
								return pendingRead?.values ?? [];
							},
							set values(v: unknown[][]) {
								store[address] = v;
								if (name === activeName) cells[address] = v;
							},
							load(_props: string): void {
								pendingRead = { values: store[address] ?? [] };
							},
						};
					},
				};
			};
			const ctx = {
				workbook: {
					worksheets: {
						getActiveWorksheet: () => makeSheet(activeName),
						getItem: (name: string) => makeSheet(name),
						items: sheetNames.map(n => ({ name: n, getRange: makeSheet(n).getRange })),
						load(_props: string): void {
							/* items already populated */
						},
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
	it("createExcelHostTools advertises read_range and write_range with JSON-schema params", () => {
		const tools = createExcelHostTools(fakeExcel());
		const names = tools.map(t => t.definition.name).sort();
		expect(names).toEqual(["list_sheets", "read_range", "write_range"]);
		for (const t of tools) {
			expect(t.definition.parameters).toMatchObject({ type: "object" });
		}
	});

	it("registerExcelTools pushes both tools to the agent via set_host_tools", () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerExcelTools(d, fakeExcel());

		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		expect(frame).toBeDefined();
		expect(frame?.tools.map(x => x.name).sort()).toEqual(["list_sheets", "read_range", "write_range"]);
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
		expect(frame?.tools.map(x => x.name).sort()).toEqual(["list_sheets", "read_range", "write_range"]);

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
