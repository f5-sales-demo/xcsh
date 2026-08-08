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
import type { ChatMessage } from "@f5-sales-demo/xcsh-chat-ui";
import type { ChatErrorReason } from "../core";
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
	"provider-auth": "The upstream service rejected the configured credential.",
	"provider-4xx": "The request was rejected by the upstream service.",
	"provider-5xx": "The upstream service encountered an error.",
};

/** Shown when local state is invalid and has no classified reason. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** Render fixed copy for a classified reason without exposing provider text. */
export function errorText(reason?: ChatErrorReason): string {
	return reason !== undefined ? ERROR_MESSAGES[reason] : GENERIC_ERROR_MESSAGE;
}

/** The session projection the transcript needs (a subset of ChatSessionResult). */
export interface SessionView {
	turns: Turn[];
	status: "idle" | "streaming" | "done" | "error";
	reason?: ChatErrorReason;
}

/**
 * Reasons where the transport itself is gone: resending on the same (closed)
 * socket cannot succeed, so the transcript offers NO Retry for these — the
 * GatewayGate Settings affordance rebuilds the transport instead. Every other
 * error (provider-*, session-busy, bridge-unresponsive, token-*, or an
 * unclassified error) keeps Retry, because the socket is still open.
 */
const TRANSPORT_DEAD_REASONS: ReadonlySet<ChatErrorReason> = new Set(["bridge-disconnected", "session-disposed"]);

/** Whether a Retry can plausibly succeed on the same transport for this reason. */
function retryable(reason?: ChatErrorReason): boolean {
	return reason === undefined || !TRANSPORT_DEAD_REASONS.has(reason);
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
 *  - Retry is offered on the LAST row when it is an error, there is a prior user
 *    prompt to resend, AND the error is {@link retryable} on the same transport —
 *    a transport-dead error (`bridge-disconnected`/`session-disposed`) offers no
 *    Retry, since resending on the closed socket would throw and orphan a
 *    perpetual "streaming" turn (the Settings affordance is the recovery path).
 */
export function turnsToMessages(view: SessionView): ChatMessage[] {
	const { turns, status, reason } = view;
	const lastUserText = [...turns].reverse().find((t): t is Extract<Turn, { kind: "user" }> => t.kind === "user")?.text;

	const msgs: ChatMessage[] = turns.flatMap(t => {
		if (t.kind === "user") return [{ id: t.id, role: "user", text: t.text } as ChatMessage];
		// Live tool-activity rows precede the assistant's text for the same turn, so
		// the reader sees "Reading workbook structure…" then the answer streams in.
		const toolRows: ChatMessage[] = t.activities.map((a, i) => ({
			id: `${t.state.id}-tool-${i}`,
			role: "tool",
			text: "",
			tool: a.tool,
			ok: a.ok,
			running: a.running,
		}));
		// A completed turn carries the sources it cited (F5 docs / console links),
		// which reduce.ts folds onto TurnState.references from the chat_done frame.
		const references =
			t.state.status === "done" && t.state.references.length > 0 ? [...t.state.references] : undefined;
		const body: ChatMessage =
			t.state.status === "error"
				? { id: t.state.id, role: "assistant", text: errorText(t.state.reason), error: true }
				: { id: t.state.id, role: "assistant", text: t.state.text, ...(references ? { references } : {}) };
		return [...toolRows, body];
	});

	// A connect-level error isn't reflected in any assistant turn — surface it.
	const lastIsError = msgs.length > 0 && msgs[msgs.length - 1].error === true;
	if (status === "error" && !lastIsError) {
		msgs.push({ id: "session-error", role: "assistant", text: errorText(reason), error: true });
	}

	// Enable Retry on the last row when it is an error, there is something to
	// resend, and the reason is retryable on the same (still-open) transport.
	const last = msgs[msgs.length - 1];
	if (last?.error && lastUserText && retryable(reason)) last.retryText = lastUserText;

	return msgs;
}
