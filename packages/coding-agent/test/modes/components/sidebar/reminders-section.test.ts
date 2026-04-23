import { beforeAll, describe, expect, it } from "bun:test";
import { TodoReminderComponent } from "../../../../src/modes/components/todo-reminder";
import { initTheme } from "../../../../src/modes/theme/theme";
import type { TodoItem } from "../../../../src/tools/todo-write";

beforeAll(async () => {
	await initTheme();
});

describe("Reminder rendering — baseline (pre-migration, locks existing behavior)", () => {
	it("TodoReminderComponent render output includes the todos, the attempt count, and the max attempts", () => {
		const todos: TodoItem[] = [
			{ id: "t1", content: "finish the migration", status: "pending" },
			{ id: "t2", content: "update the changelog", status: "pending" },
		];
		const component = new TodoReminderComponent(todos, 1, 3);
		const rows = component.render(80);
		const allText = rows.join("\n");
		expect(allText).toContain("finish the migration");
		expect(allText).toContain("update the changelog");
		expect(allText).toContain("1/3");
	});

	it("TodoReminderComponent singular vs plural label (1 todo vs N todos)", () => {
		const one: TodoItem[] = [{ id: "t", content: "only one", status: "pending" }];
		const many: TodoItem[] = [
			{ id: "a", content: "first", status: "pending" },
			{ id: "b", content: "second", status: "pending" },
		];
		const rowsOne = new TodoReminderComponent(one, 1, 3).render(80).join("\n");
		const rowsMany = new TodoReminderComponent(many, 1, 3).render(80).join("\n");
		expect(rowsOne).toContain("todo ");
		// "1 incomplete todo - reminder ..."
		expect(rowsMany).toContain("todos ");
	});
});
