import { beforeAll, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { TodoReminderComponent } from "../../src/modes/components/todo-reminder";
import { setTheme } from "../../src/modes/theme/theme";
import type { TodoItem } from "../../src/tools/todo-write";

beforeAll(async () => {
	await setTheme("xcsh-dark");
});

describe("TodoReminderComponent summary line", () => {
	it("appends a count summary at the bottom when multiple todos remain", () => {
		const todos: TodoItem[] = [
			{ id: "task-1", status: "in_progress", content: "Active work" },
			{ id: "task-2", status: "pending", content: "Next thing" },
			{ id: "task-3", status: "pending", content: "Later thing" },
		];
		const component = new TodoReminderComponent(todos, 1, 3);
		const rendered = sanitizeText(component.render(80).join("\n"));

		const lines = rendered
			.split("\n")
			.map(l => l.trimEnd())
			.filter(l => l.length > 0);
		const last = lines[lines.length - 1];
		expect(last.trim()).toBe("1 active, 2 pending");
	});

	it("omits the summary line for a single todo", () => {
		const todos: TodoItem[] = [{ id: "task-1", status: "in_progress", content: "Only task" }];
		const component = new TodoReminderComponent(todos, 1, 3);
		const rendered = sanitizeText(component.render(80).join("\n"));

		expect(rendered).not.toMatch(/\d+ (active|pending|completed)/);
	});
});
