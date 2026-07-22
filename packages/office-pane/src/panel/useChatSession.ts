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

/**
 * The single chat mode the Office pane sends. The interaction modes are a
 * Chrome browser-automation concept (they steer on-page overlays/annotations),
 * so the Office pane exposes NO mode toggle and fixes the mode to `educational`
 * ("Explain concepts… help the user understand") — the least-wrong fit for a
 * document assistant, matching the Explain/Improve/Summarize starters.
 */
export const DEFAULT_INTERACTION_MODE: InteractionMode = "educational";

/**
 * Post-connect lifecycle hooks. `provision` points xcsh's provider at the saved
 * gateway (the `configure` round-trip) and runs BEFORE `onConnected`; the session
 * sequences connect → provision → onConnected and gates chat until it resolves.
 */
export interface ChatSessionHooks {
	provision?: () => Promise<void>;
	onConnected?: () => void;
}

/**
 * Provisioning lifecycle, distinct from the chat `status`:
 * - `connecting`  — awaiting `transport.connect()`
 * - `configuring` — connected, running `provision()` (the gateway `configure`)
 * - `ready`       — provisioned; chat is enabled and host tools are advertised
 * - `error`       — `provision()` rejected (configure_error / mid-configure drop)
 */
export type Provisioning = "connecting" | "configuring" | "ready" | "error";

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
	/** Provisioning lifecycle — chat is gated until this is 'ready'. */
	provisioning: Provisioning;
	/** Set when provisioning is 'error' (a rejected provider `configure`); the
	 *  panel renders it as a non-silent, recoverable error rather than proceeding. */
	provisionError?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatSession(transport: Transport, hooks?: ChatSessionHooks): ChatSessionResult {
	const [turns, setTurns] = useState<Turn[]>([]);
	// Holds a connect() rejection; reset whenever transport changes.
	const [connectErr, setConnectErr] = useState<{ reason: ChatErrorReason; message: string } | null>(null);
	const [provisioning, setProvisioning] = useState<Provisioning>("connecting");
	const [provisionError, setProvisionError] = useState<string | undefined>(undefined);
	const counterRef = useRef(0);
	const activeTurnIdRef = useRef<string | null>(null);
	const lastUserTextRef = useRef<string>("");
	const lastUserModeRef = useRef<InteractionMode>(DEFAULT_INTERACTION_MODE);
	// Held in a ref so a changing callback identity doesn't re-run the connect effect.
	const hooksRef = useRef(hooks);
	hooksRef.current = hooks;

	useEffect(() => {
		let mounted = true;
		// Reset lifecycle state when the transport instance changes.
		setConnectErr(null);
		setProvisioning("connecting");
		setProvisionError(undefined);
		transport
			.connect()
			.then(async () => {
				if (!mounted) return;
				// Connected → point xcsh's provider at the gateway before enabling chat.
				setProvisioning("configuring");
				try {
					await hooksRef.current?.provision?.();
				} catch (err: unknown) {
					// A rejected provider configure is surfaced (never swallowed): chat
					// stays gated and host tools are NOT advertised. #2134.
					console.error("[useChatSession] provider configure failed:", err);
					if (mounted) {
						setProvisionError(err instanceof Error ? err.message : String(err));
						setProvisioning("error");
					}
					return;
				}
				if (!mounted) return;
				// Provisioned → enable chat, then advertise host tools (needs an open socket).
				setProvisioning("ready");
				hooksRef.current?.onConnected?.();
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

			try {
				transport.send({
					type: "chat_request",
					id,
					text,
					context: null,
					mode,
				});
			} catch (err) {
				// A closed/failed transport throws synchronously (e.g. "Cannot send in
				// state 'closed'"). Without this guard the optimistic assistant turn
				// above would stay in 'streaming' forever (a perpetual spinner). Fold it
				// into a terminal error so the failure is never silent; the transport is
				// gone, so this is reported as bridge-disconnected (no dead-end Retry).
				console.error("[useChatSession] transport.send() failed:", err);
				const message = err instanceof Error ? err.message : String(err);
				setTurns(prev =>
					prev.map(turn =>
						turn.kind === "assistant" && turn.state.id === id
							? {
									kind: "assistant",
									state: { ...turn.state, status: "error", error: message, reason: "bridge-disconnected" },
								}
							: turn,
					),
				);
			}
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

	return { turns, send, stop, retry, status, reason, error, provisioning, provisionError };
}
