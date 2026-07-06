/**
 * Version helpers for selecting the api-specs-enriched source.
 *
 * Kept in a dedicated module (no side effects) so the freshness logic is unit-testable
 * without importing generate-api-spec-index.ts, which runs the generator on load.
 */

/** Normalize a release tag (`v2.1.167`) or bare version (`2.1.167`) to a bare version. */
export function normalizeSpecsTag(tag: string): string {
	return tag.trim().replace(/^v/, "");
}

/**
 * Whether a local api-specs-enriched checkout matches the latest release tag.
 * A stale checkout must NOT be used, or local/dev builds silently pin to old specs.
 */
export function isLocalSpecsCurrent(localVersion: string | undefined, latestTag: string): boolean {
	if (!localVersion) return false;
	return normalizeSpecsTag(localVersion) === normalizeSpecsTag(latestTag);
}
