import type { TodoItem } from "../../../tools/todo-write";
import { theme } from "../../theme/theme";
import { SidebarSection } from "./sidebar-section";

interface ReminderState {
	todos: TodoItem[];
	attempt: number;
	maxAttempts: number;
}

/**
 * Sidebar section that renders the latest todo-reminder event.
 *
 * Subscribes to AgentSession.events.reminderFired on mount. Holds the most
 * recent reminder and renders it until replaced or cleared. No auto-clear
 * timing in v1 — a new reminder replaces the current one, and session
 * teardown unmounts the section.
 *
 * The output format mirrors the existing TodoReminderComponent (header with
 * attempt/max, todo list) so the pre-migration baseline test in
 * reminders-section.test.ts passes against both the old component and this
 * section.
 */
export class RemindersSection extends SidebarSection {
	readonly title = "Reminders";
	#current: ReminderState | null = null;
	#unsubscribe: (() => void) | null = null;
	#mounted = false;

	mount(): void {
		this.#unsubscribe = this.session.events.on("reminderFired", payload => {
			this.#current = { ...payload };
			this.markDirty();
		});
		this.#mounted = true;
	}

	unmount(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#mounted = false;
	}

	isActive(): boolean {
		return this.#mounted;
	}

	render(_width: number): string[] {
		if (!this.#current) {
			// No reminder yet — render nothing.
			return [];
		}
		const { todos, attempt, maxAttempts } = this.#current;
		const count = todos.length;
		const label = count === 1 ? "todo" : "todos";
		const header = `${theme.icon.warning} ${count} incomplete ${label} - reminder ${attempt}/${maxAttempts}`;
		const rows: string[] = [theme.inverse(theme.fg("warning", header))];
		for (const t of todos) {
			rows.push(`  ${theme.checkbox.unchecked} ${t.content}`);
		}
		return rows;
	}
}
