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

function fakeReplayedSession(reconstructed: TodoPhase[]): AgentSession {
	const bus = new TypedEventEmitter<AgentSessionEvents>();
	return {
		events: bus,
		// Simulates #syncTodoPhasesFromBranch having already run during
		// AgentSession construction — getTodoPhases returns the reconstructed
		// phases BEFORE mount() is called.
		getTodoPhases: () => reconstructed,
	} as unknown as AgentSession;
}

describe("TodosSection + SidebarComponent — cold-start replay (no empty-flash)", () => {
	it("first render after mount shows reconstructed phases — no empty frame", () => {
		const reconstructed: TodoPhase[] = [
			{
				id: "p1",
				name: "Phase 1",
				tasks: [{ id: "t1", content: "resume work", status: "in_progress" }],
			},
		];
		const session = fakeReplayedSession(reconstructed);
		const sidebar = new SidebarComponent({ requestRender: () => {} }, onDirty => [
			new TodosSection(session, {} as Settings, onDirty),
		]);
		// Before mount, sections are inactive → sidebar shows dim line.
		const beforeMount = sidebar.render(30).join("\n");
		expect(beforeMount).toContain("no active sections");
		// After mount, first render must show the reconstructed content.
		sidebar.mount();
		const afterMount = sidebar.render(30).join("\n");
		expect(afterMount).toContain("resume work");
		// Specifically: the first render is NOT the empty-todos state; it
		// jumps directly to the reconstructed content.
		expect(afterMount).not.toContain("no todos");
	});
});
