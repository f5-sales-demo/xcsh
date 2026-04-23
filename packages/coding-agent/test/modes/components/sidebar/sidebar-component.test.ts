import { beforeAll, describe, expect, it } from "bun:test";
import type { Settings } from "../../../../src/config/settings";
import { SidebarComponent } from "../../../../src/modes/components/sidebar/sidebar-component";
import { SidebarSection } from "../../../../src/modes/components/sidebar/sidebar-section";
import { initTheme } from "../../../../src/modes/theme/theme";
import type { AgentSession } from "../../../../src/session/agent-session";

beforeAll(async () => {
	await initTheme();
});

// Minimal TUI stub exposing only the methods SidebarComponent uses.
function makeUiStub() {
	let renders = 0;
	return {
		ui: {
			requestRender: () => {
				renders++;
			},
		} as { requestRender: () => void },
		getRenders: () => renders,
	};
}

// Minimal AgentSession + Settings stubs. The sections only touch
// session/settings through this base constructor parameter; SidebarComponent
// itself does not use them.
const dummySession = {} as AgentSession;
const dummySettings = {} as Settings;

class TrackingSection extends SidebarSection {
	readonly title: string;
	mounted = false;
	unmounted = false;
	constructor(title: string, onDirty: (s: SidebarSection) => void) {
		super(dummySession, dummySettings, onDirty);
		this.title = title;
	}
	isActive(): boolean {
		return this.mounted && !this.unmounted;
	}
	mount(): void {
		this.mounted = true;
	}
	unmount(): void {
		this.unmounted = true;
	}
	render(_width: number): string[] {
		return [`${this.title}`];
	}
}

describe("SidebarComponent — mount/unmount lifecycle", () => {
	it("mount() calls mount() on every section in construction order", () => {
		const { ui } = makeUiStub();
		const order: string[] = [];
		const sidebar = new SidebarComponent(ui, onDirty => {
			const a = new TrackingSection("A", onDirty);
			const b = new TrackingSection("B", onDirty);
			const c = new TrackingSection("C", onDirty);
			const trace = (s: TrackingSection) => {
				const orig = s.mount.bind(s);
				s.mount = () => {
					order.push(s.title);
					orig();
				};
			};
			trace(a);
			trace(b);
			trace(c);
			return [a, b, c];
		});
		sidebar.mount();
		expect(order).toEqual(["A", "B", "C"]);
	});

	it("unmount() calls unmount() on every section in construction order", () => {
		const { ui } = makeUiStub();
		const order: string[] = [];
		const sidebar = new SidebarComponent(ui, onDirty => {
			const a = new TrackingSection("A", onDirty);
			const b = new TrackingSection("B", onDirty);
			const trace = (s: TrackingSection) => {
				const orig = s.unmount.bind(s);
				s.unmount = () => {
					order.push(s.title);
					orig();
				};
			};
			trace(a);
			trace(b);
			return [a, b];
		});
		sidebar.mount();
		sidebar.unmount();
		expect(order).toEqual(["A", "B"]);
	});
});

describe("SidebarComponent — markSectionDirty microtask coalesce", () => {
	it("collapses N synchronous markSectionDirty calls into a single requestRender after one microtask flush", async () => {
		const { ui, getRenders } = makeUiStub();
		let sectionA: TrackingSection;
		const sidebar = new SidebarComponent(ui, onDirty => {
			sectionA = new TrackingSection("A", onDirty);
			return [sectionA];
		});
		sidebar.mount();
		// Burst 10 markSectionDirty calls synchronously.
		for (let i = 0; i < 10; i++) sidebar.markSectionDirty(sectionA!);
		// No requestRender yet — it's been queued behind a microtask.
		expect(getRenders()).toBe(0);
		await Promise.resolve(); // flush microtask queue
		expect(getRenders()).toBe(1);
	});

	it("re-arms on the next burst after the microtask has flushed", async () => {
		const { ui, getRenders } = makeUiStub();
		let sectionA: TrackingSection;
		const sidebar = new SidebarComponent(ui, onDirty => {
			sectionA = new TrackingSection("A", onDirty);
			return [sectionA];
		});
		sidebar.mount();
		sidebar.markSectionDirty(sectionA!);
		await Promise.resolve();
		expect(getRenders()).toBe(1);
		sidebar.markSectionDirty(sectionA!);
		await Promise.resolve();
		expect(getRenders()).toBe(2);
	});
});

describe("SidebarComponent — all-sections-inactive rendering", () => {
	it("renders a single dim 'no active sections' line when every section isActive() is false", () => {
		const { ui } = makeUiStub();
		const sidebar = new SidebarComponent(ui, onDirty => {
			const a = new TrackingSection("A", onDirty);
			// Keep it unmounted so isActive() stays false.
			return [a];
		});
		// Do NOT call sidebar.mount(); sections stay inactive.
		const rows = sidebar.render(30);
		expect(rows).toHaveLength(1);
		// Must contain the literal string "no active sections" somewhere.
		expect(rows[0]).toContain("no active sections");
		// Must have some SGR styling (dim/muted).
		expect(rows[0]).toMatch(/\x1b\[/);
	});

	it("renders section content (not the dim line) when at least one section isActive()", () => {
		const { ui } = makeUiStub();
		const sidebar = new SidebarComponent(ui, onDirty => [new TrackingSection("ActiveSec", onDirty)]);
		sidebar.mount();
		const rows = sidebar.render(30);
		// The active TrackingSection renders `"ActiveSec"`. Our invariant:
		// rows contain the section output AND do NOT contain the no-active hint.
		expect(rows.some(r => r.includes("ActiveSec"))).toBe(true);
		expect(rows.every(r => !r.includes("no active sections"))).toBe(true);
	});
});
