/**
 * Pure reduceChatTurn: folds one stream event into immutable TurnState.
 *
 * KEPT LOCAL: this reducer has no native xcsh counterpart. It is browser-safe
 * presentation logic — accumulating streamed deltas into ordered text with one
 * enhancement over a naive fold: out-of-order deltas are buffered by `seq` and
 * flushed in ascending order once the gap closes, so the accumulated text is
 * always seq-ordered regardless of network arrival order.
 */

import type { ChatRefWire, ChatStreamMsg } from "./messages";
import type { ChatErrorReason } from "./reasons";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TurnState {
	readonly id: string;
	readonly text: string;
	readonly status: "streaming" | "done" | "error";
	readonly references: readonly ChatRefWire[];
	readonly reason?: ChatErrorReason;
	/** Highest seq number whose delta has been appended to `text`. Starts at -1. */
	readonly lastSeq: number;
	/** Out-of-order deltas buffered until their preceding seq arrives. */
	readonly pending: Readonly<Record<number, string>>;
}

export function initTurn(id: string): TurnState {
	return { id, text: "", status: "streaming", references: [], lastSeq: -1, pending: {} };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Fold one inbound stream event into turn state. Idempotent after terminal. */
export function reduceChatTurn(state: TurnState, msg: ChatStreamMsg): TurnState {
	if (msg.id !== state.id) return state; // not this turn — ignore
	if (state.status !== "streaming") return state; // terminal: ignore stragglers

	if (msg.type === "chat_delta") {
		if (msg.seq <= state.lastSeq) return state; // duplicate

		// Merge incoming delta into the pending buffer
		const merged: Record<number, string> = { ...state.pending, [msg.seq]: msg.delta };

		// Flush all consecutive deltas starting from lastSeq + 1
		let text = state.text;
		let lastSeq = state.lastSeq;
		let next = lastSeq + 1;
		while (Object.hasOwn(merged, next)) {
			text += merged[next];
			lastSeq = next;
			next++;
		}

		// Retain only the unflushed gap entries
		const pending: Record<number, string> = {};
		for (const [k, v] of Object.entries(merged)) {
			if (Number(k) > lastSeq) pending[Number(k)] = v;
		}

		return { ...state, text, lastSeq, pending };
	}

	if (msg.type === "chat_done") {
		// Flush the contiguous run from pending before closing.
		// WebSocket delivery is ordered per-connection, so `pending` is normally empty;
		// this flush keeps the (plan-mandated) buffering internally coherent on close.
		// A genuine seq gap (a permanently missing delta) is unrecoverable — its gapped
		// successors are intentionally discarded when the turn closes, which is correct
		// (missing data cannot be invented).
		let text = state.text;
		let lastSeq = state.lastSeq;
		let next = lastSeq + 1;
		while (Object.hasOwn(state.pending, next)) {
			text += state.pending[next];
			lastSeq = next;
			next++;
		}
		return { ...state, text, lastSeq, pending: {}, status: "done", references: msg.references ?? [] };
	}

	// chat_error — same flush logic: clear pending, keep coherence.
	// WebSocket delivery is ordered per-connection, so `pending` is normally empty;
	// this flush keeps the (plan-mandated) buffering internally coherent on close.
	// A genuine seq gap (a permanently missing delta) is unrecoverable — its gapped
	// successors are intentionally discarded when the turn closes, which is correct
	// (missing data cannot be invented).
	let text = state.text;
	let lastSeq = state.lastSeq;
	let next = lastSeq + 1;
	while (Object.hasOwn(state.pending, next)) {
		text += state.pending[next];
		lastSeq = next;
		next++;
	}
	return { ...state, text, lastSeq, pending: {}, status: "error", reason: msg.reason };
}
