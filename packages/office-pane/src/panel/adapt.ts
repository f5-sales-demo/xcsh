/**
 * Pure adapters mapping the office pane's session view-model onto the shared
 * `@f5-sales-demo/xcsh-chat-ui` prop contract. Kept framework-free and
 * side-effect-free so it is exhaustively unit-testable.
 *
 * `ERROR_MESSAGES` (and the generic fallback) migrated here from the retired
 * Fluent `ErrorBanner`: the reason→message mapping is presentation logic the
 * shared `ErrorMessage`/`Transcript` render, and the exhaustive
 * `Record<ChatErrorReason, string>` still forces every reason to be covered at
 * compile time (a new reason without a message is a type error).
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import type { ChatMessage, InteractionMode as UiMode } from "@f5-sales-demo/xcsh-chat-ui";
import type { ChatErrorReason, InteractionMode } from "../core";
import { INTERACTION_MODES } from "../core";
import type { Turn } from "./useChatSession";

/** Exhaustive human-readable message for every {@link ChatErrorReason}. */
export const ERROR_MESSAGES: Record<ChatErrorReason, string> = {
	"bridge-disconnected": "Connection to the assistant was lost.",
	"bridge-unresponsive": "The assistant stopped responding.",
	"no-worker": "No assistant worker is running for this tab.",
	"session-busy": "A request is already in progress — please wait and retry.",
	"session-disposed": "The assistant session was closed.",
	"token-expired": "Your session token has expired. Please sign in again.",
	"token-expiring": "Your session token is about to expire.",
	"provider-4xx": "The request was rejected by the upstream service.",
	"provider-5xx": "The upstream service encountered an error.",
};

/** Shown when an error has no classified reason and no raw text is available. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * The best available message for an errored turn: a mapped message for a
 * classified `reason`, else the raw `error` text, else a generic fallback — so
 * an errored session never renders a silent, empty state.
 */
export function errorText(reason?: ChatErrorReason, error?: string): string {
	return reason !== undefined ? ERROR_MESSAGES[reason] : error?.trim() || GENERIC_ERROR_MESSAGE;
}

/** The session projection the transcript needs (a subset of ChatSessionResult). */
export interface SessionView {
	turns: Turn[];
	status: "idle" | "streaming" | "done" | "error";
	reason?: ChatErrorReason;
	error?: string;
}

/**
 * Project the accumulated office `Turn[]` (+ session-level error state) onto the
 * shared `ChatMessage[]`:
 *  - user turns → user rows; assistant turns → assistant rows (partial text kept
 *    while streaming);
 *  - an assistant turn whose own state errored renders the classified message;
 *  - a connect-level error not tied to a turn (e.g. `transport.connect()`
 *    rejection, which never produces an assistant turn) appends one synthetic
 *    error row so the failure is never silent;
 *  - Retry is offered on the LAST row when it is an error and there is a prior
 *    user prompt to resend (the shared Transcript wires the button to `onRetry`).
 */
export function turnsToMessages(view: SessionView): ChatMessage[] {
	const { turns, status, reason, error } = view;
	const lastUserText = [...turns].reverse().find((t): t is Extract<Turn, { kind: "user" }> => t.kind === "user")?.text;

	const msgs: ChatMessage[] = turns.map(t =>
		t.kind === "user"
			? { id: t.id, role: "user", text: t.text }
			: t.state.status === "error"
				? { id: t.state.id, role: "assistant", text: errorText(t.state.reason, t.state.error), error: true }
				: { id: t.state.id, role: "assistant", text: t.state.text },
	);

	// A connect-level error isn't reflected in any assistant turn — surface it.
	const lastIsError = msgs.length > 0 && msgs[msgs.length - 1].error === true;
	if (status === "error" && !lastIsError) {
		msgs.push({ id: "session-error", role: "assistant", text: errorText(reason, error), error: true });
	}

	// Enable Retry on the last row when it is an error and something can be resent.
	const last = msgs[msgs.length - 1];
	if (last?.error && lastUserText) last.retryText = lastUserText;

	return msgs;
}

/** Title-case a lowercase interaction-mode id for the composer's mode toggle. */
function label(id: InteractionMode): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
}

/** The interaction modes offered in the composer's mode toggle. */
export const MODE_OPTIONS: UiMode[] = INTERACTION_MODES.map(id => ({ id, label: label(id) }));
