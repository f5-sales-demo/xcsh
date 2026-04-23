import type { Settings } from "../../../config/settings";
import type { AgentSession } from "../../../session/agent-session";

/**
 * Abstract base for a section hosted inside SidebarComponent.
 *
 * Sections are stateful: they subscribe to AgentSession.events in mount()
 * and dispose subscriptions in unmount(). They render into a width given
 * by the sidebar, and call markDirty() when their state changes so the
 * sidebar can coalesce re-renders.
 *
 * Lifecycle:
 *   mount()   — pull current state + subscribe
 *   render(w) — produce lines for the given width
 *   unmount() — dispose subscriptions
 *
 * isActive() — returns true after mount(), false after unmount().
 * Content-state rendering (e.g. "no todos") is the section's responsibility,
 * NOT what isActive() reports.
 */
export abstract class SidebarSection {
	readonly #onDirty: (section: SidebarSection) => void;

	constructor(
		protected readonly session: AgentSession,
		protected readonly settings: Settings,
		onDirty: (section: SidebarSection) => void,
	) {
		this.#onDirty = onDirty;
	}

	abstract readonly title: string;

	abstract isActive(): boolean;

	abstract render(width: number): string[];

	/** Pull initial state and subscribe. Called by SidebarComponent.mount(). */
	abstract mount(): void;

	/** Dispose subscriptions. Called by SidebarComponent.unmount(). */
	abstract unmount(): void;

	/** Fire the onDirty callback given at construction time. */
	protected markDirty(): void {
		this.#onDirty(this);
	}
}
