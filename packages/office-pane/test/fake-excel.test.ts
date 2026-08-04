import { describe, expect, test } from "bun:test";
import { createExcelHostTools } from "../src/office/excel-tools";
import { fakeExcel } from "./support/fake-excel";

function tool(name: string, excel: ReturnType<typeof fakeExcel>) {
	const registration = createExcelHostTools(excel).find(candidate => candidate.definition.name === name);
	if (!registration) throw new Error(`Missing Excel tool ${name}`);
	return registration.handler;
}

describe("stateful fake Excel workbook", () => {
	test("keeps the first Start sheet active and snapshots by value", async () => {
		const excel = fakeExcel({}, { Start: { "A1:B1": [["sentinel", "keep"]] } });
		const before = excel.snapshot();

		await tool("add_sheet", excel)({ name: "Report" }, {} as never);
		await tool("write_range", excel)({ address: "Report!A1:B1", values: [["score", 21]] }, {} as never);

		expect(excel.activeSheetName()).toBe("Start");
		expect(before).toEqual({
			activeSheet: "Start",
			sheets: { Start: { "A1:B1": [["sentinel", "keep"]] } },
		});
		expect(excel.snapshot()).toEqual({
			activeSheet: "Start",
			sheets: {
				Start: { "A1:B1": [["sentinel", "keep"]] },
				Report: { "A1:B1": [["score", 21]] },
			},
		});
	});

	test("worksheet enumeration sees sheets added after the fake was created", async () => {
		const excel = fakeExcel({}, { Start: {} });
		await tool("add_sheet", excel)({ name: "MEDDPICC — Example Corp" }, {} as never);

		const result = await tool("list_sheets", excel)({}, {} as never);
		expect(result.details).toEqual({ sheets: ["Start", "MEDDPICC — Example Corp"] });
		expect(excel.sheetNames()).toEqual(["Start", "MEDDPICC — Example Corp"]);
	});
});
