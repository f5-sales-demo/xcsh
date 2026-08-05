import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { settings } from "../../../config/settings";
import { evaluateToolCall } from "../../../sandbox/enforce";
import { resolveSessionFence } from "../../../sandbox/session-fence";

/**
 * Session filesystem sandbox (bundled, default-on).
 *
 * Removes casual cross-session discovery from model-invoked filesystem tools while preserving the
 * operator's normal rights on every named path. Enforcement is a `tool_call` gate: the extension wrapper
 * blocks the tool when this returns `{ block: true }`, and fails safe (a thrown handler
 * also blocks).
 *
 * The boundary is derived from `ctx.cwd` (always the live session's directory) plus the
 * `sandbox.*` settings. Controlled by `sandbox.enabled` (default true); discovery is widened per run
 * with `--allow-path` / `--no-sandbox` or the `sandbox.allow*` settings.
 */
export default function sandboxGuard(pi: ExtensionAPI): void {
	// Policy construction and caching live in sandbox/session-policy.ts, shared with the bash
	// tool's internal-URL boundary check so the two cannot disagree about what is reachable.
	// An extension only ever sees the module-global settings proxy, so that is the reader it
	// passes; the bash tool passes its own session's Settings instance instead.
	pi.on("tool_call", (event, ctx) => {
		const fence = resolveSessionFence(ctx.cwd, settings as unknown as { get(key: string): unknown });
		if (!fence) return undefined; // --no-sandbox / sandbox.enabled = false
		const decision = evaluateToolCall({
			toolName: event.toolName,
			input: event.input as Record<string, unknown>,
			cwd: ctx.cwd,
			fence,
		});
		return decision.block ? { block: true, reason: decision.reason } : undefined;
	});
}
