import { getAgentDir, getConfigRootDir, pathIsWithin } from "@f5-sales-demo/pi-utils";

// Extensions that ship with xcsh use a "bundled:" pseudo-path (no real file).
// They are not user-authored, so tests asserting on user extensions ignore them.
const BUNDLED_PREFIX = "bundled:";

export function filterUserExtensions<T extends { path: string }>(extensions: T[]): T[] {
	const roots = [getConfigRootDir(), getAgentDir()];
	return extensions.filter(
		ext => !roots.some(root => pathIsWithin(root, ext.path)) && !ext.path.startsWith(BUNDLED_PREFIX),
	);
}

export function filterUserExtensionErrors<T extends { path: string }>(errors: T[]): T[] {
	const roots = [getConfigRootDir(), getAgentDir()];
	return errors.filter(
		err => !roots.some(root => pathIsWithin(root, err.path)) && !err.path.startsWith(BUNDLED_PREFIX),
	);
}
