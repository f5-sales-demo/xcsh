/**
 * Resolving a session's filesystem boundary from its settings.
 *
 * Two places need the same boundary: the `sandbox-guard` extension, which gates every tool call, and
 * the bash tool, which both confines its shell with it and must refuse an internal URL that resolves
 * outside it (#2468). They read settings from different places — the guard has only the module-global
 * proxy, while the bash tool holds its session's own `Settings` instance, which `createAgentSession`
 * may have been given as an isolated one. So the reader is a parameter rather than an import: a
 * `cwd`-only signature cannot tell two same-cwd sessions apart, and would enforce one session's
 * boundary in the other.
 *
 * This returns a `ContainmentFence`, which is the *only* boundary object (#2624). It used to return a
 * `SandboxPolicy` — deny-by-default, confined to the cwd — while the fence below it was
 * allow-by-default with targeted denies, so the effective boundary was their intersection and the
 * intersection refused ordinary work. One object means the pre-check and the kernel cannot disagree.
 */
import { buildContainmentFence, type ContainmentFence } from "./containment";

/**
 * Trusted context added to commands launched by the fenced model bash tool.
 *
 * A subprocess cannot infer the session anchor after a command-local `cd`, and an inherited OS
 * sandbox cannot be loosened. The installed sandbox diagnostic uses these values to place its
 * allow-side fixtures inside paths the live bash profile already grants instead of inventing a
 * second workspace under the system temp directory (#2800).
 */
export const SANDBOX_SESSION_ROOT_ENV = "XCSH_SANDBOX_SESSION_ROOT";
export const SANDBOX_OPERATOR_HOME_ENV = "XCSH_SANDBOX_OPERATOR_HOME";
export const SANDBOX_CHECK_NAMED_SIBLING_ENV = "XCSH_SANDBOX_CHECK_NAMED_SIBLING";

/** The slice of `Settings` this needs — supplied explicitly so the caller names its own source. */
export interface SettingsReader {
	get(key: string): unknown;
}

/** Bounded so a long-lived process holding many sessions cannot grow this without limit. */
const CACHE_LIMIT = 8;
const cache = new Map<string, ContainmentFence>();

/**
 * The global settings proxy throws before `Settings.init()` (some SDK and test contexts). Fall back
 * to the given default there so a caller never hard-fails on a missing setting.
 */
function readSetting<T>(settings: SettingsReader, key: string, fallback: T): T {
	try {
		const value = settings.get(key);
		return value === undefined ? fallback : (value as T);
	} catch {
		return fallback;
	}
}

/** Extra roots a caller grants beyond the settings — a session temp dir, the artifacts dir. */
export interface SessionFenceExtras {
	sessionTmp?: string;
	extraRoots?: readonly string[];
}

/**
 * The session's fence for `workspace`, or undefined when sandboxing is off.
 *
 * Cached on the full effective configuration — the workspace plus the resolved enable flag, both
 * allow-lists and any extra roots — not on the workspace alone. Keying on the allow-lists is what lets
 * a mid-session `settings.override("sandbox.allowRead", …)` take effect, as when the Office pane grants
 * a user-picked folder; a workspace-only key would keep serving the stale fence and block the path that
 * was just granted. The key only ever triggers more rebuilds, never fewer restrictions.
 */
export function resolveSessionFence(
	workspace: string,
	settings: SettingsReader,
	extras: SessionFenceExtras = {},
): ContainmentFence | undefined {
	// Fail closed: if `sandbox.enabled` cannot be read, keep isolation on rather than silently
	// dropping it. In a normal session, settings resolves the real default.
	if (!readSetting(settings, "sandbox.enabled", true)) return undefined;

	const allowRead = readSetting<string[]>(settings, "sandbox.allowRead", []);
	const allowWrite = readSetting<string[]>(settings, "sandbox.allowWrite", []);
	const signature = [
		workspace,
		JSON.stringify(allowRead),
		JSON.stringify(allowWrite),
		extras.sessionTmp ?? "",
		JSON.stringify(extras.extraRoots ?? []),
	].join(" ");

	const cached = cache.get(signature);
	if (cached) return cached;

	// The three grants stay distinct. Merging allowRead and allowWrite into one read+write list made a
	// folder shared for reading writable, undoing the split built for #2516. A root in *both* lists is
	// the deliberate exception the fence itself handles, because that is what `--allow-path` produces.
	const fence = buildContainmentFence({
		workspace,
		sessionTmp: extras.sessionTmp,
		extraRoots: extras.extraRoots,
		readOnlyRoots: allowRead,
		writeOnlyRoots: allowWrite,
	});
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(signature, fence);
	return fence;
}
