import { beforeAll, describe, expect, it } from "bun:test";
import { TypedEventEmitter } from "@f5xc-salesdemos/pi-tui";
import type { Settings } from "../../../../src/config/settings";
import type { SidebarSection } from "../../../../src/modes/components/sidebar/sidebar-section";
import { TodosSection } from "../../../../src/modes/components/sidebar/todos-section";
import { initTheme } from "../../../../src/modes/theme/theme";
import type { AgentSession, AgentSessionEvents } from "../../../../src/session/agent-session";
import type { TodoPhase } from "../../../../src/tools/todo-write";

beforeAll(async () => {
	await initTheme();
});

function makeSession(initialPhases: TodoPhase[]): AgentSession {
	const bus = new TypedEventEmitter<AgentSessionEvents>();
	let phases = initialPhases;
	return {
		events: bus,
		getTodoPhases: () => phases.map(p => ({ ...p, tasks: p.tasks.map(t => ({ ...t })) })),
		setPhases: (next: TodoPhase[]) => {
			phases = next;
			bus.emit("todoPhasesChanged", { phases: next });
		},
	} as unknown as AgentSession;
}

const dummySettings = {} as Settings;

describe("TodosSection — mount/subscribe/render", () => {
	it("mount() seeds internal state from session.getTodoPhases()", () => {
		const session = makeSession([
			{
				id: "p1",
				name: "Phase 1",
				tasks: [{ id: "t1", content: "do thing", status: "in_progress", notes: null } as never],
			},
		]);
		const dirtyCalls: SidebarSection[] = [];
		const section = new TodosSection(session, dummySettings, s => dirtyCalls.push(s));
		section.mount();
		const rows = section.render(30);
		expect(rows.some(r => r.includes("do thing"))).toBe(true);
	});

	it("todoPhasesChanged triggers markDirty and state update", () => {
		const session = makeSession([]);
		const dirtyCalls: SidebarSection[] = [];
		const section = new TodosSection(session, dummySettings, s => dirtyCalls.push(s));
		section.mount();
		expect(section.render(30).some(r => r.includes("no todos"))).toBe(true);
		(session as unknown as { setPhases: (phases: TodoPhase[]) => void }).setPhases([
			{
				id: "p",
				name: "New",
				tasks: [{ id: "t", content: "new task", status: "pending", notes: null } as never],
			},
		]);
		expect(dirtyCalls).toHaveLength(1);
		expect(dirtyCalls[0]).toBe(section);
		expect(section.render(30).some(r => r.includes("new task"))).toBe(true);
	});

	it("empty state renders a dim 'no todos' line", () => {
		const session = makeSession([]);
		const section = new TodosSection(session, dummySettings, () => {});
		section.mount();
		const rows = section.render(30);
		expect(rows.some(r => r.includes("no todos"))).toBe(true);
		// dim marker
		expect(rows.some(r => /\x1b\[/.test(r))).toBe(true);
	});

	it("unmount() unsubscribes so subsequent events do not reach the section", () => {
		const session = makeSession([]);
		const dirtyCalls: SidebarSection[] = [];
		const section = new TodosSection(session, dummySettings, s => dirtyCalls.push(s));
		section.mount();
		section.unmount();
		(session as unknown as { setPhases: (phases: TodoPhase[]) => void }).setPhases([
			{
				id: "p",
				name: "Ignored",
				tasks: [{ id: "t", content: "nope", status: "pending", notes: null } as never],
			},
		]);
		expect(dirtyCalls).toHaveLength(0);
	});

	it("isActive() reflects mounted state", () => {
		const session = makeSession([]);
		const section = new TodosSection(session, dummySettings, () => {});
		expect(section.isActive()).toBe(false);
		section.mount();
		expect(section.isActive()).toBe(true);
		section.unmount();
		expect(section.isActive()).toBe(false);
	});
});
