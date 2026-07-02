import { getConfigRootDir } from "@f5-sales-demo/pi-utils";

// Extensions that ship with xcsh use a "bundled:" pseudo-path (no real file).
// They are not user-authored, so tests asserting on user extensions ignore them.
const BUNDLED_PREFIX = "bundled:";

export function filterUserExtensions<T extends { path: string }>(extensions: T[]): T[] {
	const configRoot = getConfigRootDir();
	return extensions.filter(ext => !ext.path.startsWith(configRoot) && !ext.path.startsWith(BUNDLED_PREFIX));
}

export function filterUserExtensionErrors<T extends { path: string }>(errors: T[]): T[] {
	const configRoot = getConfigRootDir();
	return errors.filter(err => !err.path.startsWith(configRoot) && !err.path.startsWith(BUNDLED_PREFIX));
}
