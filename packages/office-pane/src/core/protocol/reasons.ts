/**
 * Shared vocabulary for chat protocol error reasons and interaction modes.
 *
 * The TYPES (`ChatErrorReason`, `InteractionMode`) are imported from xcsh's
 * native browser contract (`@f5-sales-demo/xcsh/browser/chat-protocol`) — a
 * type-only import that is fully erased at build time, so no node-coupled xcsh
 * runtime ever reaches the browser bundle.
 *
 * The runtime arrays below are kept LOCAL:
 *  - `CHAT_ERROR_REASONS` is an inherently cross-surface synchronized list (the
 *    contract itself notes "keep both lists identical" across xcsh + hosts).
 *    `satisfies readonly ChatErrorReason[]` binds every value to the native type
 *    at compile time, and `reasons.test.ts` asserts parity against the native
 *    `chat-conformance.json` — so drift is caught in CI without importing any
 *    xcsh runtime value into browser-safe code.
 *  - `INTERACTION_MODES` has no native runtime counterpart (native ships only
 *    the `InteractionMode` type), so it lives here as pane-only presentation.
 */
import type { ChatErrorReason, InteractionMode } from "@f5-sales-demo/xcsh/browser/chat-protocol";

export type { ChatErrorReason, InteractionMode };

/** Machine-readable causes of a terminal chat_error. Shared vocabulary with xcsh
 * (keep both lists identical). Every terminal error carries one known reason. */
export const CHAT_ERROR_REASONS = [
	"bridge-disconnected", // the worker's bridge closed mid-turn
	"bridge-unresponsive", // the socket looked open but the worker never answered
	"no-worker", // no worker is running for this tab
	"session-busy", // a turn is already in flight for this session
	"session-disposed", // the worker session was torn down
	"token-expired", // F5 XC API token expired
	"token-expiring", // F5 XC API token is about to expire
	"provider-4xx", // upstream provider rejected the request (client error)
	"provider-5xx", // upstream provider failed (server error) — retryable
] as const satisfies readonly ChatErrorReason[];

/** Interaction modes a user can select when sending a chat_request. */
export const INTERACTION_MODES = [
	"educational",
	"presentation",
	"configuration",
	"screenshot",
	"annotation",
] as const satisfies readonly InteractionMode[];
