import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { settings } from "../../../config/settings";
import { containmentStatus } from "../../../sandbox/containment";
import { evaluateToolCall } from "../../../sandbox/enforce";
import { resolveSessionPolicy } from "../../../sandbox/session-policy";

/**
 * Session filesystem sandbox (bundled, default-on).
 *
 * Confines the model-invoked file tools (read/write/edit/find/grep) and the Bash
 * working directory to the session's CWD subtree plus a curated global allowlist, so
 * concurrent sessions in different customer folders cannot read or write each other's
 * files, secrets, or memory. Enforcement is a `tool_call` gate: the extension wrapper
 * blocks the tool when this returns `{ block: true }`, and fails safe (a thrown handler
 * also blocks).
 *
 * The boundary is derived from `ctx.cwd` (always the live session's directory) plus the
 * `sandbox.*` settings. Controlled by `sandbox.enabled` (default true); widened per run
 * with `--allow-path` / `--no-sandbox` or the `sandbox.allow*` settings.
 */
export default function sandboxGuard(pi: ExtensionAPI): void {
	// Policy construction and caching live in sandbox/session-policy.ts, shared with the bash
	// tool's internal-URL boundary check so the two cannot disagree about what is reachable.
	// An extension only ever sees the module-global settings proxy, so that is the reader it
	// passes; the bash tool passes its own session's Settings instance instead.
	pi.on("tool_call", (event, ctx) => {
		const policy = resolveSessionPolicy(ctx.cwd, settings as unknown as { get(key: string): unknown });
		if (!policy) return undefined;
		const decision = evaluateToolCall({
			toolName: event.toolName,
			input: event.input as Record<string, unknown>,
			cwd: ctx.cwd,
			policy,
			// Asked per call rather than cached at load: the answer comes from a probe of the running
			// kernel, and a session can be created before the native module has been reached. The probe
			// itself memoises, so this costs nothing after the first call. When an OS backend confines the
			// shell, the command-text scan stops deciding for `bash` — see the #2582 note in enforce.ts.
			shellOsConfined: containmentStatus(true).osEnforced,
		});
		return decision.block ? { block: true, reason: decision.reason } : undefined;
	});
}
