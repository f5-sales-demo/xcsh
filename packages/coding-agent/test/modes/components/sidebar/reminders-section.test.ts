import { beforeAll, describe, expect, it } from "bun:test";
import { TypedEventEmitter } from "@f5xc-salesdemos/pi-tui";
import type { Settings } from "../../../../src/config/settings";
import { RemindersSection } from "../../../../src/modes/components/sidebar/reminders-section";
import { TodoReminderComponent } from "../../../../src/modes/components/todo-reminder";
import { initTheme } from "../../../../src/modes/theme/theme";
import type { AgentSession, AgentSessionEvents } from "../../../../src/session/agent-session";
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

function makeSession(): AgentSession {
	const bus = new TypedEventEmitter<AgentSessionEvents>();
	return { events: bus } as unknown as AgentSession;
}

const dummySettings = {} as Settings;

describe("RemindersSection — preserves TodoReminderComponent render contract", () => {
	it("after mount, rendering a reminderFired event shows todos content + attempt/max", () => {
		const session = makeSession();
		let dirtyCount = 0;
		const section = new RemindersSection(session, dummySettings, () => {
			dirtyCount++;
		});
		section.mount();
		expect(section.isActive()).toBe(true);
		const before = section.render(80).join("\n");
		expect(before).not.toContain("finish the migration");
		session.events.emit("reminderFired", {
			todos: [{ id: "t1", content: "finish the migration", status: "pending" }],
			attempt: 1,
			maxAttempts: 3,
		});
		expect(dirtyCount).toBe(1);
		const after = section.render(80).join("\n");
		expect(after).toContain("finish the migration");
		expect(after).toContain("1/3");
	});

	it("unmount disposes the subscription (no markDirty after unmount)", () => {
		const session = makeSession();
		let dirtyCount = 0;
		const section = new RemindersSection(session, dummySettings, () => {
			dirtyCount++;
		});
		section.mount();
		section.unmount();
		session.events.emit("reminderFired", {
			todos: [{ id: "t", content: "ignored", status: "pending" }],
			attempt: 1,
			maxAttempts: 1,
		});
		expect(dirtyCount).toBe(0);
	});
});
