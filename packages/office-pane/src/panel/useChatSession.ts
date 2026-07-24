/**
 * useChatSession — React hook that wires a Transport to accumulated TurnState.
 *
 * Browser-safe: no node:* imports, no Office.js.
 * The hook does not import any concrete transport — callers inject one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
	type ChatErrorReason,
	type ChatImageMsg,
	type InteractionMode,
	initTurn,
	isSkillsList,
	reduceChatTurn,
	type SkillInfo,
	type Transport,
	type TurnState,
} from "../core";
import { foldToolNotice, settleActivities, type ToolActivity } from "./tool-activity";

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
	/** Live tool-activity rows for this turn, folded from `chat_tool_notice`
	 *  (both host and engine tools), in call order. */
	activities: ToolActivity[];
}

export type Turn = UserTurn | AssistantTurn;

/** Optional per-send extras. `mode` overrides the fixed Office mode (retry only);
 *  `images` are photo/image attachments sent as vision blocks. */
export interface SendOptions {
	mode?: InteractionMode;
	images?: ChatImageMsg[];
}

export interface ChatSessionResult {
	turns: Turn[];
	send(text: string, opts?: SendOptions): void;
	stop(): void;
	retry(): void;
	/** Start a fresh conversation: clear the transcript and reset the engine's
	 *  history (the next turn carries a new `history_hint`, which the bridge maps
	 *  to `replaceMessages([])`). */
	newChat(): void;
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
	/** The engine's loaded skills, requested on connect — powers the composer's
	 *  Skills submenu. Empty until the `skills` reply arrives (or if none load). */
	skills: SkillInfo[];
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
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const counterRef = useRef(0);
	const activeTurnIdRef = useRef<string | null>(null);
	const lastUserTextRef = useRef<string>("");
	const lastUserModeRef = useRef<InteractionMode>(DEFAULT_INTERACTION_MODE);
	const lastUserImagesRef = useRef<ChatImageMsg[] | undefined>(undefined);
	// Conversation boundary: sent on every chat_request; a NEW value tells the
	// bridge to reset the engine's history (replaceMessages([])). Bumped by newChat().
	const historyHintRef = useRef(1);
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
				// Ask the engine for its loaded skills to populate the composer's Skills
				// submenu. Best-effort: a failure just leaves the submenu empty.
				try {
					transport.send({ type: "list_skills" });
				} catch {
					/* transport already gone — skip; the submenu stays empty */
				}
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
				const terminal = msg.type === "chat_done" || msg.type === "chat_error";
				setTurns(prev =>
					prev.map(turn => {
						if (turn.kind === "assistant" && turn.state.id === msg.id) {
							// A terminal frame settles any activity still marked running.
							const activities = terminal ? settleActivities(turn.activities) : turn.activities;
							return { kind: "assistant", state: reduceChatTurn(turn.state, msg), activities };
						}
						return turn;
					}),
				);
			} else if (isSkillsList(msg)) {
				// The engine's loaded skills — cache them for the composer's Skills submenu.
				setSkills(msg.skills);
			} else if (msg.type === "chat_tool_notice") {
				// Live tool activity: fold the notice into its turn's activity list so
				// the transcript shows "Reading data…" while xcsh works (Claude parity).
				setTurns(prev =>
					prev.map(turn =>
						turn.kind === "assistant" && turn.state.id === msg.id
							? { kind: "assistant", state: turn.state, activities: foldToolNotice(turn.activities, msg) }
							: turn,
					),
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
		(text: string, opts?: SendOptions) => {
			const mode = opts?.mode ?? DEFAULT_INTERACTION_MODE;
			const images = opts?.images;
			counterRef.current += 1;
			const id = `c-${counterRef.current}`;
			lastUserTextRef.current = text;
			lastUserModeRef.current = mode;
			lastUserImagesRef.current = images;
			activeTurnIdRef.current = id;

			const userTurn: UserTurn = { kind: "user", id: `u-${counterRef.current}`, text };
			const assistantTurn: AssistantTurn = { kind: "assistant", state: initTurn(id), activities: [] };

			setTurns(prev => [...prev, userTurn, assistantTurn]);

			try {
				transport.send({
					type: "chat_request",
					id,
					text,
					context: null,
					mode,
					history_hint: `conv-${historyHintRef.current}`,
					// Only attach `images` when present so a text-only turn stays a clean frame.
					...(images && images.length > 0 ? { images } : {}),
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
									activities: turn.activities,
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
		// Retry re-sends the last prompt AND its images (an image-only turn has empty
		// text, so guard on either being present).
		if (lastUserTextRef.current || (lastUserImagesRef.current?.length ?? 0) > 0) {
			send(lastUserTextRef.current, { mode: lastUserModeRef.current, images: lastUserImagesRef.current });
		}
	}, [send]);

	const newChat = useCallback(() => {
		// Abort any in-flight turn on the SERVER first (chat_stop). Otherwise a turn
		// that's still running (or wedged waiting on an unanswered host tool) keeps
		// going after the reset, and the next send queues behind it forever — the
		// "spins on Thinking… until a worker restart" trap. A closed transport throws
		// on send; the reset below still clears the UI regardless.
		if (activeTurnIdRef.current) {
			try {
				transport.stop(activeTurnIdRef.current);
			} catch {
				/* transport gone — nothing to abort; fall through to the local reset */
			}
		}
		// Bump the conversation boundary so the NEXT send resets the engine's history,
		// clear the transcript, and forget the last prompt (nothing to retry into the
		// fresh chat). Ids stay monotonic (counterRef is not reset) to avoid collisions.
		historyHintRef.current += 1;
		activeTurnIdRef.current = null;
		lastUserTextRef.current = "";
		lastUserImagesRef.current = undefined;
		setTurns([]);
	}, [transport]);

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

	return { turns, send, stop, retry, newChat, status, reason, error, provisioning, provisionError, skills };
}
