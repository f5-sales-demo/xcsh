import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { settings } from "../../../config/settings";
import { evaluateToolCall } from "../../../sandbox/enforce";
import { buildDefaultSandboxPolicy, type SandboxPolicy } from "../../../sandbox/policy";

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
	// One policy per cwd — rebuilt only when the working directory changes.
	let cache: { cwd: string; policy: SandboxPolicy } | undefined;

	// The global settings proxy throws before Settings.init() (e.g. some SDK/test
	// contexts). Fall back to the given default there so the guard never hard-fails.
	function readSetting<T>(key: string, fallback: T): T {
		try {
			const value = (settings as unknown as { get(k: string): unknown }).get(key);
			return value === undefined ? fallback : (value as T);
		} catch {
			return fallback;
		}
	}

	function policyFor(cwd: string): SandboxPolicy | undefined {
		// Fail closed: if `sandbox.enabled` can't be read, keep isolation on rather than
		// silently disabling it. In a normal session settings resolves the true default.
		if (!readSetting<boolean>("sandbox.enabled", true)) return undefined;
		if (cache?.cwd === cwd) return cache.policy;
		const policy = buildDefaultSandboxPolicy({
			cwd,
			enabled: true,
			allowRead: readSetting<string[]>("sandbox.allowRead", []),
			allowWrite: readSetting<string[]>("sandbox.allowWrite", []),
		});
		cache = { cwd, policy };
		return policy;
	}

	pi.on("tool_call", (event, ctx) => {
		const policy = policyFor(ctx.cwd);
		if (!policy) return undefined;
		const decision = evaluateToolCall({
			toolName: event.toolName,
			input: event.input as Record<string, unknown>,
			cwd: ctx.cwd,
			policy,
		});
		return decision.block ? { block: true, reason: decision.reason } : undefined;
	});
}
