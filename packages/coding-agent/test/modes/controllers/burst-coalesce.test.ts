import { beforeAll, describe, expect, it } from "bun:test";
import { TypedEventEmitter } from "@f5xc-salesdemos/pi-tui";
import type { Settings } from "../../../src/config/settings";
import { SidebarComponent } from "../../../src/modes/components/sidebar/sidebar-component";
import { TodosSection } from "../../../src/modes/components/sidebar/todos-section";
import { initTheme } from "../../../src/modes/theme/theme";
import type { AgentSession, AgentSessionEvents } from "../../../src/session/agent-session";
import type { TodoPhase } from "../../../src/tools/todo-write";

beforeAll(async () => {
	await initTheme();
});

function fakeSession(initial: TodoPhase[] = []): AgentSession & { fireBurst: (phases: TodoPhase[][]) => void } {
	const bus = new TypedEventEmitter<AgentSessionEvents>();
	let current = initial;
	return {
		events: bus,
		getTodoPhases: () => current,
		fireBurst: (burst: TodoPhase[][]) => {
			// Emit all burst frames synchronously.
			for (const phases of burst) {
				current = phases;
				bus.emit("todoPhasesChanged", { phases });
			}
		},
	} as unknown as AgentSession & { fireBurst: (phases: TodoPhase[][]) => void };
}

describe("SidebarComponent + TodosSection — burst-coalesce", () => {
	it("N synchronous setTodoPhases-style emissions collapse into one requestRender after microtask flush", async () => {
		const session = fakeSession([]);
		let renderCount = 0;
		const ui = {
			requestRender: () => {
				renderCount++;
			},
		};
		const sidebar = new SidebarComponent(ui, onDirty => [new TodosSection(session, {} as Settings, onDirty)]);
		sidebar.mount();
		// Burst 5 synchronous emissions.
		const burst: TodoPhase[][] = [];
		for (let i = 0; i < 5; i++) {
			burst.push([
				{
					id: `p${i}`,
					name: `Phase ${i}`,
					tasks: [{ id: `t${i}`, content: `task ${i}`, status: "pending" }],
				},
			]);
		}
		session.fireBurst(burst);
		// Pre-flush: no requestRender yet (coalesce is microtask-gated).
		expect(renderCount).toBe(0);
		// Microtask flush.
		await Promise.resolve();
		expect(renderCount).toBe(1);
	});
});
