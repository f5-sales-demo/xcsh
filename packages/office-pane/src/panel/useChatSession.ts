/**
 * useChatSession — React hook that wires a Transport to accumulated TurnState.
 *
 * Browser-safe: no node:* imports, no Office.js.
 * The hook does not import any concrete transport — callers inject one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
	type ChatErrorReason,
	type InteractionMode,
	initTurn,
	reduceChatTurn,
	type Transport,
	type TurnState,
} from "../core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const DEFAULT_INTERACTION_MODE: InteractionMode = "configuration";

export interface UserTurn {
	kind: "user";
	id: string;
	text: string;
}

export interface AssistantTurn {
	kind: "assistant";
	state: TurnState;
}

export type Turn = UserTurn | AssistantTurn;

export interface ChatSessionResult {
	turns: Turn[];
	send(text: string, mode?: InteractionMode): void;
	stop(): void;
	retry(): void;
	status: "idle" | "streaming" | "done" | "error";
	/** Populated when status is 'error'; mirrors TurnState.reason for turn errors
	 *  and is set to 'bridge-disconnected' for transport.connect() failures. */
	reason?: ChatErrorReason;
	/** Raw error text when status is 'error'; the fallback shown when `reason`
	 *  is absent (an unclassified error), so the banner is never silent. */
	error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatSession(transport: Transport, onConnected?: () => void): ChatSessionResult {
	const [turns, setTurns] = useState<Turn[]>([]);
	// Holds a connect() rejection; reset whenever transport changes.
	const [connectErr, setConnectErr] = useState<{ reason: ChatErrorReason; message: string } | null>(null);
	const counterRef = useRef(0);
	const activeTurnIdRef = useRef<string | null>(null);
	const lastUserTextRef = useRef<string>("");
	const lastUserModeRef = useRef<InteractionMode>(DEFAULT_INTERACTION_MODE);
	// Held in a ref so a changing callback identity doesn't re-run the connect effect.
	const onConnectedRef = useRef(onConnected);
	onConnectedRef.current = onConnected;

	useEffect(() => {
		let mounted = true;
		// Reset any prior connect error when the transport instance changes.
		setConnectErr(null);
		transport
			.connect()
			.then(() => {
				// Fire the connected hook once the transport is open, so callers can
				// advertise host tools (set_host_tools requires an open socket).
				if (mounted) onConnectedRef.current?.();
			})
			.catch((err: unknown) => {
				console.error("[useChatSession] transport.connect() failed:", err);
				if (mounted) {
					setConnectErr({
						reason: "bridge-disconnected",
						message: err instanceof Error ? err.message : String(err),
					});
				}
			});
		const unsub = transport.onMessage(msg => {
			// Narrow to ChatStreamMsg via the discriminated union on `type`.
			if (msg.type === "chat_delta" || msg.type === "chat_done" || msg.type === "chat_error") {
				setTurns(prev =>
					prev.map(turn => {
						if (turn.kind === "assistant" && turn.state.id === msg.id) {
							return { kind: "assistant", state: reduceChatTurn(turn.state, msg) };
						}
						return turn;
					}),
				);
			}
		});
		// Unsubscribe on unmount — do not dispose, the transport outlives this hook.
		return () => {
			mounted = false;
			unsub();
		};
	}, [transport]);

	const send = useCallback(
		(text: string, mode: InteractionMode = DEFAULT_INTERACTION_MODE) => {
			counterRef.current += 1;
			const id = `c-${counterRef.current}`;
			lastUserTextRef.current = text;
			lastUserModeRef.current = mode;
			activeTurnIdRef.current = id;

			const userTurn: UserTurn = { kind: "user", id: `u-${counterRef.current}`, text };
			const assistantTurn: AssistantTurn = { kind: "assistant", state: initTurn(id) };

			setTurns(prev => [...prev, userTurn, assistantTurn]);

			transport.send({
				type: "chat_request",
				id,
				text,
				context: null,
				mode,
			});
		},
		[transport],
	);

	const stop = useCallback(() => {
		if (activeTurnIdRef.current) {
			transport.stop(activeTurnIdRef.current);
		}
	}, [transport]);

	const retry = useCallback(() => {
		if (lastUserTextRef.current) {
			send(lastUserTextRef.current, lastUserModeRef.current);
		}
	}, [send]);

	const lastAssistant = turns.findLast((t): t is AssistantTurn => t.kind === "assistant");

	// connect() failures take precedence; fall back to the last assistant turn's status.
	// Design note: we expose `reason` directly on ChatSessionResult (same field name/type
	// as TurnState.reason) rather than injecting a synthetic turn, to avoid rendering a
	// spurious chat bubble for a connection-level error.
	let status: ChatSessionResult["status"];
	let reason: ChatErrorReason | undefined;
	let error: string | undefined;
	if (connectErr) {
		status = "error";
		reason = connectErr.reason;
		error = connectErr.message;
	} else if (lastAssistant) {
		status = lastAssistant.state.status;
		reason = lastAssistant.state.reason;
		error = lastAssistant.state.error;
	} else {
		status = "idle";
	}

	return { turns, send, stop, retry, status, reason, error };
}
