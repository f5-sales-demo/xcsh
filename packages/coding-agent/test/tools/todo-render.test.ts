import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import chalk from "chalk";
import { getThemeByName } from "../../src/modes/theme/theme";
import { formatTodoLine, renderTodoSummary } from "../../src/tools/todo-render";
import type { TodoItem } from "../../src/tools/todo-write";

async function dark() {
	const theme = await getThemeByName("xcsh-dark");
	if (!theme) throw new Error("dark theme not found");
	return theme;
}

describe("formatTodoLine", () => {
	it("renders completed with chromeAccent check + dim strikethrough content", async () => {
		const theme = await dark();
		const item: TodoItem = { id: "task-1", status: "completed", content: "Done thing" };
		const line = formatTodoLine(item, theme, "");

		expect(line).toContain(theme.fg("chromeAccent", theme.todo.done));
		expect(line).toContain(theme.fg("dim", chalk.strikethrough("Done thing")));
		expect(sanitizeText(line)).toBe(`${theme.todo.done} Done thing`);
	});

	it("renders in_progress with warning symbol and bold warning content", async () => {
		const theme = await dark();
		const item: TodoItem = { id: "task-1", status: "in_progress", content: "Active thing" };
		const line = formatTodoLine(item, theme, "");

		expect(line).toContain(theme.fg("warning", theme.todo.active));
		expect(line).toContain(theme.fg("warning", chalk.bold("Active thing")));
		expect(sanitizeText(line)).toBe(`${theme.todo.active} Active thing`);
	});

	it("renders in_progress details on subsequent dim lines with prefix", async () => {
		const theme = await dark();
		const item: TodoItem = {
			id: "task-1",
			status: "in_progress",
			content: "Active thing",
			details: "First detail\nSecond detail",
		};
		const line = formatTodoLine(item, theme, "  ");
		const lines = line.split("\n");

		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain(theme.fg("warning", chalk.bold("Active thing")));
		expect(lines[1]).toBe(theme.fg("dim", "    First detail"));
		expect(lines[2]).toBe(theme.fg("dim", "    Second detail"));
	});

	it("renders pending with dim symbol and dim content", async () => {
		const theme = await dark();
		const item: TodoItem = { id: "task-1", status: "pending", content: "Pending thing" };
		const line = formatTodoLine(item, theme, "");

		expect(line).toContain(theme.fg("dim", theme.todo.pending));
		expect(line).toContain(theme.fg("dim", "Pending thing"));
		expect(sanitizeText(line)).toBe(`${theme.todo.pending} Pending thing`);
	});

	it("renders abandoned with error symbol and error strikethrough content", async () => {
		const theme = await dark();
		const item: TodoItem = { id: "task-1", status: "abandoned", content: "Dropped thing" };
		const line = formatTodoLine(item, theme, "");

		expect(line).toContain(theme.fg("error", theme.todo.abandoned));
		expect(line).toContain(theme.fg("error", chalk.strikethrough("Dropped thing")));
		expect(sanitizeText(line)).toBe(`${theme.todo.abandoned} Dropped thing`);
	});
});

describe("renderTodoSummary", () => {
	const task = (status: TodoItem["status"], n: number): TodoItem => ({
		id: `task-${n}`,
		status,
		content: `Task ${n}`,
	});

	it("returns null for an empty list", async () => {
		const theme = await dark();
		expect(renderTodoSummary([], theme)).toBeNull();
	});

	it("returns null for a single task", async () => {
		const theme = await dark();
		expect(renderTodoSummary([task("in_progress", 1)], theme)).toBeNull();
	});

	it("renders active + pending + completed counts in dim", async () => {
		const theme = await dark();
		const tasks: TodoItem[] = [
			task("in_progress", 1),
			...Array.from({ length: 12 }, (_, i) => task("pending", i + 2)),
			...Array.from({ length: 2 }, (_, i) => task("completed", i + 14)),
		];

		const summary = renderTodoSummary(tasks, theme);
		expect(summary).not.toBeNull();
		expect(sanitizeText(summary!)).toBe("1 active, 12 pending, 2 completed");
		expect(summary!).toBe(theme.fg("dim", "1 active, 12 pending, 2 completed"));
	});

	it("drops the 0-active segment when there is no active task", async () => {
		const theme = await dark();
		const tasks: TodoItem[] = [
			...Array.from({ length: 12 }, (_, i) => task("pending", i + 1)),
			...Array.from({ length: 2 }, (_, i) => task("completed", i + 13)),
		];

		const summary = renderTodoSummary(tasks, theme);
		expect(sanitizeText(summary!)).toBe("12 pending, 2 completed");
	});

	it("renders only the completed count when all tasks are completed", async () => {
		const theme = await dark();
		const tasks = Array.from({ length: 5 }, (_, i) => task("completed", i + 1));

		const summary = renderTodoSummary(tasks, theme);
		expect(sanitizeText(summary!)).toBe("5 completed");
	});
});
