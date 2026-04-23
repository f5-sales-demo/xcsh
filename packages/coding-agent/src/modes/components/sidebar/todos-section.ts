import type { TodoPhase } from "../../../tools/todo-write";
import { theme } from "../../theme/theme";
import { SidebarSection } from "./sidebar-section";

/**
 * Sidebar section that renders the current todo phases.
 *
 * mount() pulls current phases via session.getTodoPhases(), then subscribes
 * to AgentSession.events.todoPhasesChanged. Updates call markDirty() to let
 * the parent SidebarComponent coalesce re-renders.
 *
 * Empty state renders a single dim "no todos" line. Non-empty state renders
 * a compact phase/task summary using existing theme glyphs.
 */
export class TodosSection extends SidebarSection {
	readonly title = "Todos";
	#phases: TodoPhase[] = [];
	#unsubscribe: (() => void) | null = null;
	#mounted = false;

	mount(): void {
		this.#phases = this.session.getTodoPhases();
		this.#unsubscribe = this.session.events.on("todoPhasesChanged", ({ phases }) => {
			this.#phases = phases;
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
		if (this.#phases.length === 0) {
			return [theme.fg("muted", "no todos")];
		}
		const rows: string[] = [];
		rows.push(theme.bold(this.title));
		for (const phase of this.#phases) {
			rows.push(theme.fg("contentAccent", phase.name));
			for (const task of phase.tasks) {
				const glyph =
					task.status === "completed"
						? theme.checkbox.checked
						: task.status === "in_progress"
							? theme.todo.active
							: theme.checkbox.unchecked;
				rows.push(`  ${glyph} ${task.content}`);
			}
		}
		return rows;
	}
}
