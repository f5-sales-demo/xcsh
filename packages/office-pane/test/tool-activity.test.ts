import { describe, expect, test } from "bun:test";
import type { ChatToolNoticeMsg } from "../src/core";
import { foldToolNotice, settleActivities, type ToolActivity } from "../src/panel/tool-activity";

function notice(tool: string, ok = true): ChatToolNoticeMsg {
	return { type: "chat_tool_notice", id: "c-1", tool, ok };
}

describe("foldToolNotice", () => {
	test("a first notice for a tool STARTS a running activity", () => {
		const next = foldToolNotice([], notice("get_workbook_info"));
		expect(next).toEqual([{ tool: "get_workbook_info", running: true, ok: true }]);
	});

	test("a second notice for the same tool SETTLES the running activity (carrying its ok)", () => {
		const started = foldToolNotice([], notice("read_range"));
		const settled = foldToolNotice(started, notice("read_range", true));
		expect(settled).toEqual([{ tool: "read_range", running: false, ok: true }]);
	});

	test("a failing end notice settles the activity as not-ok", () => {
		const started = foldToolNotice([], notice("write_range"));
		const settled = foldToolNotice(started, notice("write_range", false));
		expect(settled).toEqual([{ tool: "write_range", running: false, ok: false }]);
	});

	test("distinct tools accumulate as separate rows in call order", () => {
		let acts: ToolActivity[] = [];
		acts = foldToolNotice(acts, notice("get_workbook_info"));
		acts = foldToolNotice(acts, notice("get_workbook_info")); // end
		acts = foldToolNotice(acts, notice("read_range"));
		expect(acts).toEqual([
			{ tool: "get_workbook_info", running: false, ok: true },
			{ tool: "read_range", running: true, ok: true },
		]);
	});

	test("sequential calls to the SAME tool produce two distinct rows", () => {
		let acts: ToolActivity[] = [];
		acts = foldToolNotice(acts, notice("read_range")); // start #1
		acts = foldToolNotice(acts, notice("read_range")); // end #1
		acts = foldToolNotice(acts, notice("read_range")); // start #2
		expect(acts).toEqual([
			{ tool: "read_range", running: false, ok: true },
			{ tool: "read_range", running: true, ok: true },
		]);
	});

	test("does not mutate the input array", () => {
		const acts: ToolActivity[] = [];
		foldToolNotice(acts, notice("x"));
		expect(acts).toEqual([]);
	});
});

describe("settleActivities", () => {
	test("marks every still-running activity as settled", () => {
		const acts: ToolActivity[] = [
			{ tool: "a", running: true, ok: true },
			{ tool: "b", running: false, ok: true },
		];
		expect(settleActivities(acts)).toEqual([
			{ tool: "a", running: false, ok: true },
			{ tool: "b", running: false, ok: true },
		]);
	});

	test("returns the same reference when nothing is running (no needless churn)", () => {
		const acts: ToolActivity[] = [{ tool: "a", running: false, ok: true }];
		expect(settleActivities(acts)).toBe(acts);
	});
});
