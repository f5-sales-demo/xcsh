import { getKeybindings, type Keybinding } from "../keybindings";
import { matchesKey } from "../keys";
import { Loader } from "./loader";

/**
 * Loader that requests interruption with the application's interrupt binding (Ctrl+C by default).
 * Extends Loader with an AbortSignal for cancelling async operations.
 *
 * @example
 * const loader = new CancellableLoader(tui, cyan, dim, "Working...");
 * // Keep tracking work until it acknowledges loader.signal; onAbort is only a request.
 * doWork(loader.signal).then(done);
 */
export class CancellableLoader extends Loader {
	#abortController = new AbortController();

	/** Called once when interruption is requested, not when work has necessarily stopped. */
	onAbort?: () => void;

	/** AbortSignal that is aborted when interruption is requested. */
	get signal(): AbortSignal {
		return this.#abortController.signal;
	}

	/** Whether the loader was aborted */
	get aborted(): boolean {
		return this.#abortController.signal.aborted;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		// The optional application binding is supplied by downstream registry augmentation.
		const interrupt = "app.interrupt" as Keybinding;
		const requested = kb.getDefinition(interrupt) ? kb.matches(data, interrupt) : matchesKey(data, "ctrl+c");
		if (requested && !this.aborted) {
			this.#abortController.abort();
			this.onAbort?.();
		}
	}

	dispose(): void {
		this.stop();
	}
}
