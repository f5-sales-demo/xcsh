import type { ChordResult } from "@f5-sales-demo/pi-tui";

/**
 * Sinks invoked by routeChordResult. Exactly one of these fires per call
 * (or neither, for pending / abandoned — which are intentionally swallowed
 * so the user's partial chord never leaks into the editor buffer).
 */
export interface ChordRouteSinks {
	action: (actionId: string) => void;
	editor: (key: string) => void;
}

/**
 * Pure routing: given a ChordResult, dispatch to the right sink.
 *
 * - `dispatched` → action sink (keybinding matched a complete chord)
 * - `passthrough` → editor sink (key is not a chord leader or match)
 * - `pending` / `abandoned` → swallowed (Emacs convention: an abandoned
 *   leader does not emit the second key into the buffer)
 *
 * Extracted so tests can exercise routing logic without constructing a
 * full InputController.
 */
export function routeChordResult(result: ChordResult, key: string, sinks: ChordRouteSinks): void {
	switch (result.kind) {
		case "dispatched":
			sinks.action(result.action);
			return;
		case "passthrough":
			sinks.editor(key);
			return;
		case "pending":
		case "abandoned":
			// Swallowed — Emacs convention for abandoned leaders.
			return;
	}
}
