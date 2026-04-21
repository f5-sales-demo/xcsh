import chalk from "chalk";
import type { Theme } from "../modes/theme/theme";
import type { TodoItem } from "./todo-write";

export function formatTodoLine(item: TodoItem, theme: Theme, prefix: string): string {
	switch (item.status) {
		case "completed":
			return `${prefix}${theme.fg("chromeAccent", theme.todo.done)} ${theme.fg("dim", chalk.strikethrough(item.content))}`;
		case "in_progress": {
			const main = `${prefix}${theme.fg("warning", theme.todo.active)} ${theme.fg("warning", chalk.bold(item.content))}`;
			if (!item.details) return main;
			const detailLines = item.details.split("\n").map(l => theme.fg("dim", `${prefix}  ${l}`));
			return [main, ...detailLines].join("\n");
		}
		case "abandoned":
			return `${prefix}${theme.fg("error", theme.todo.abandoned)} ${theme.fg("error", chalk.strikethrough(item.content))}`;
		default:
			return `${prefix}${theme.fg("dim", theme.todo.pending)} ${theme.fg("dim", item.content)}`;
	}
}

export function renderTodoSummary(tasks: TodoItem[], theme: Theme): string | null {
	if (tasks.length <= 1) return null;
	const active = tasks.filter(t => t.status === "in_progress").length;
	const pending = tasks.filter(t => t.status === "pending").length;
	const completed = tasks.filter(t => t.status === "completed").length;
	const parts: string[] = [];
	if (active > 0) parts.push(`${active} active`);
	if (pending > 0) parts.push(`${pending} pending`);
	if (completed > 0) parts.push(`${completed} completed`);
	if (parts.length === 0) return null;
	return theme.fg("dim", parts.join(", "));
}
