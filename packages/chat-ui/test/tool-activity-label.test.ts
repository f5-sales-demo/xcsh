import { describe, expect, test } from "bun:test";
import { toolActivityLabel } from "../src/tools/activity-label";

describe("toolActivityLabel", () => {
	test("maps every Excel host tool to a friendly present-tense label", () => {
		expect(toolActivityLabel("get_workbook_info")).toBe("Reading workbook structure");
		expect(toolActivityLabel("list_sheets")).toBe("Listing sheets");
		expect(toolActivityLabel("read_range")).toBe("Reading cells");
		expect(toolActivityLabel("read_table")).toBe("Reading table");
		expect(toolActivityLabel("get_formulas")).toBe("Reading formulas");
		expect(toolActivityLabel("get_cell_metadata")).toBe("Reading cell formatting");
		expect(toolActivityLabel("read_named_range")).toBe("Reading named range");
		expect(toolActivityLabel("write_range")).toBe("Writing cells");
		expect(toolActivityLabel("sort_filter_table")).toBe("Sorting table");
	});

	test("maps every Word host tool to a friendly label", () => {
		expect(toolActivityLabel("read_document")).toBe("Reading document");
		expect(toolActivityLabel("get_document_info")).toBe("Reading document structure");
		expect(toolActivityLabel("read_paragraphs")).toBe("Reading paragraphs");
		expect(toolActivityLabel("read_selection")).toBe("Reading selection");
		expect(toolActivityLabel("get_comments")).toBe("Reading comments");
		expect(toolActivityLabel("get_tracked_changes")).toBe("Reading tracked changes");
		expect(toolActivityLabel("insert_text")).toBe("Inserting text");
		expect(toolActivityLabel("insert_paragraph")).toBe("Inserting paragraph");
	});

	test("maps every PowerPoint host tool to a friendly label", () => {
		expect(toolActivityLabel("read_slides")).toBe("Reading slides");
		expect(toolActivityLabel("get_presentation_info")).toBe("Reading presentation structure");
		expect(toolActivityLabel("read_slide_shapes")).toBe("Reading slide shapes");
		expect(toolActivityLabel("read_slide_layout")).toBe("Reading slide layout");
		expect(toolActivityLabel("add_slide")).toBe("Adding slide");
		expect(toolActivityLabel("add_text_box")).toBe("Adding text box");
		expect(toolActivityLabel("modify_shape_text")).toBe("Editing shape text");
	});

	test("humanizes unknown snake_case tool names gracefully (browser/other tools)", () => {
		expect(toolActivityLabel("navigate")).toBe("Navigate");
		expect(toolActivityLabel("read_page")).toBe("Read page");
		expect(toolActivityLabel("take_screenshot")).toBe("Take screenshot");
	});

	test("trims and tolerates empty / whitespace tool names without throwing", () => {
		expect(toolActivityLabel("")).toBe("Working");
		expect(toolActivityLabel("   ")).toBe("Working");
	});

	test("names provider-side (server) tools for what the user is waiting on (#2340)", () => {
		expect(toolActivityLabel("web_search")).toBe("Searching the web");
		expect(toolActivityLabel("web_fetch")).toBe("Fetching a page");
	});
});
