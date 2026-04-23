import { Container } from "@f5xc-salesdemos/pi-tui";
import type { SidebarSection } from "./sidebar-section";

/** Minimal TUI shape SidebarComponent depends on. */
interface TUIRef {
	requestRender(force?: boolean): void;
}

/**
 * Right-side sidebar container that hosts one or more SidebarSection instances.
 *
 * Factory pattern: the caller passes a function that receives the sidebar's
 * bound `onDirty` callback. The callback wires `SidebarSection.markDirty()`
 * to this sidebar's `markSectionDirty()` at construction time so sections
 * never hold a parent reference.
 *
 * Coalesce: markSectionDirty queues a microtask to call ui.requestRender()
 * at most once per sync batch (Task 5).
 *
 * All-sections-inactive: renders a single dim "no active sections" line
 * rather than disappearing (Task 6).
 *
 * The right border of the sidebar is owned here; the vertical separator
 * between sidebar and main column is owned by HorizontalSplit (the parent
 * layout primitive used in interactive-mode, Task 19). Neither layer draws
 * the other's chrome.
 */
export class SidebarComponent extends Container {
	readonly #ui: TUIRef;
	readonly #sections: SidebarSection[];

	constructor(ui: TUIRef, makeSections: (onDirty: (s: SidebarSection) => void) => SidebarSection[]) {
		super();
		this.#ui = ui;
		const onDirty = (s: SidebarSection) => this.markSectionDirty(s);
		this.#sections = makeSections(onDirty);
	}

	mount(): void {
		for (const section of this.#sections) section.mount();
	}

	unmount(): void {
		for (const section of this.#sections) section.unmount();
	}

	markSectionDirty(_section: SidebarSection): void {
		// Coalesce logic lands in Task 5.
		this.#ui.requestRender();
	}

	render(_width: number): string[] {
		// Placeholder — full render lands in Task 6 (all-sections-inactive) and
		// Task 7 (section composition).
		return [];
	}
}
