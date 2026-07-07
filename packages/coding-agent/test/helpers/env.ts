/**
 * Restore `process.env` to a captured snapshot IN PLACE.
 *
 * Do NOT do `process.env = { ...snapshot }`. In Bun, `process.env` and `Bun.env`
 * are the same object, and `$env` (packages/utils) captures `Bun.env` at module
 * load. Reassigning `process.env` replaces it with a fresh object, permanently
 * disconnecting it from `Bun.env`/`$env`. After that, later writes such as
 * `process.env.EXA_API_KEY = "..."` are invisible to `getEnvApiKey()` and every
 * other `$env` reader — silently breaking unrelated test files that share the
 * one `bun test` process. That defect turned the whole web-search suite red in CI
 * (see issue #1903). Mutating in place preserves the object identity.
 */
export function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const key of Object.keys(process.env)) {
		if (!(key in snapshot)) delete process.env[key];
	}
	Object.assign(process.env, snapshot);
}
