import { describe, expect, it } from "bun:test";
import type { Settings } from "../../../../src/config/settings";
import { SidebarComponent } from "../../../../src/modes/components/sidebar/sidebar-component";
import { SidebarSection } from "../../../../src/modes/components/sidebar/sidebar-section";
import type { AgentSession } from "../../../../src/session/agent-session";

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
