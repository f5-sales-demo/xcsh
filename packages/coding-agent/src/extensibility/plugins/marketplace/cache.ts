/**
 * Plugin cache management.
 *
 * Cache layout: `<cacheDir>/<marketplace>___<pluginName>___<version>/`
 *
 * All three components are validated before any filesystem operation:
 *   - marketplace / pluginName: isValidNameSegment (lowercase alnum + hyphens, max 64)
 *   - version: isValidVersionForCache (alnum + ._+-, max 128)
 *
 * This ensures cache paths cannot be crafted to escape the cache directory.
 */

import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { isEnoent } from "@f5-sales-demo/pi-utils";

import { isValidNameSegment } from "./types";

// Reject anything that could be used for path traversal or shell injection in
// version strings. Only printable, unambiguous characters are allowed.
const VERSION_RE = /^[a-zA-Z0-9._+-]+$/;

/** Return true when `version` is safe for use as a cache path component. */
export function isValidVersionForCache(version: string): boolean {
	// prevent path-traversal sequences like ".." or "1..2"
	return version.length > 0 && version.length <= 128 && VERSION_RE.test(version) && !version.includes("..");
}

function validateCacheComponents(marketplace: string, pluginName: string, version: string): void {
	if (!isValidNameSegment(marketplace)) {
		throw new Error(`Invalid marketplace name for cache: "${marketplace}"`);
	}
	if (!isValidNameSegment(pluginName)) {
		throw new Error(`Invalid plugin name for cache: "${pluginName}"`);
	}
	if (!isValidVersionForCache(version)) {
		throw new Error(`Invalid version for cache: "${version}"`);
	}
}

/**
 * Return the absolute path for a cached plugin directory.
 * Throws if any component fails validation.
 */
export function getCachedPluginPath(
	cacheDir: string,
	marketplace: string,
	pluginName: string,
	version: string,
): string {
	validateCacheComponents(marketplace, pluginName, version);
	return path.join(cacheDir, `${marketplace}___${pluginName}___${version}`);
}

/**
 * Copy `sourcePath` into the cache, returning the absolute cache path.
 *
 * Idempotent: if the target already exists it is removed before copying,
 * so a partial previous cache is never silently reused.
 */
export async function cachePlugin(
	sourcePath: string,
	cacheDir: string,
	marketplace: string,
	pluginName: string,
	version: string,
): Promise<string> {
	const targetPath = getCachedPluginPath(cacheDir, marketplace, pluginName, version);

	// Ensure cache directory exists before writing into it
	await fs.mkdir(cacheDir, { recursive: true });

	// Copy to a staging directory first, then atomically rename into place.
	// This prevents destroying an active install if fs.cp fails mid-copy.
	const stagingPath = `${targetPath}.staging-${process.pid}-${randomUUID()}`;
	try {
		await fs.cp(sourcePath, stagingPath, { recursive: true });
		await fs.rm(targetPath, { recursive: true, force: true });
		await fs.rename(stagingPath, targetPath);
	} catch (err) {
		// Clean up staging dir on any failure; leave existing targetPath intact
		await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
		throw err;
	}

	return targetPath;
}

async function pluginTreeDigest(root: string): Promise<string> {
	const hash = createHash("sha256");
	const visit = async (directory: string, prefix = ""): Promise<void> => {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolute = path.join(directory, entry.name);
			const stat = await fs.lstat(absolute);
			hash
				.update(relative)
				.update("\0")
				.update((stat.mode & 0o777).toString(8))
				.update("\0");
			if (entry.isDirectory()) {
				hash.update("directory\0");
				await visit(absolute, relative);
			} else if (entry.isFile()) {
				hash
					.update("file\0")
					.update(await fs.readFile(absolute))
					.update("\0");
			} else if (entry.isSymbolicLink()) {
				hash
					.update("symlink\0")
					.update(await fs.readlink(absolute))
					.update("\0");
			} else {
				throw new Error(`Unsupported plugin source entry: ${relative}`);
			}
		}
	};
	await visit(root);
	return hash.digest("hex");
}

/** Cache a local development source without ever replacing a path an active process may still use. */
export async function cachePluginSnapshot(
	sourcePath: string,
	cacheDir: string,
	marketplace: string,
	pluginName: string,
	version: string,
): Promise<string> {
	const sourceDigest = await pluginTreeDigest(sourcePath);
	const snapshotVersion = `${version}+snapshot.${sourceDigest.slice(0, 16)}`;
	const targetPath = getCachedPluginPath(cacheDir, marketplace, pluginName, snapshotVersion);
	try {
		if ((await pluginTreeDigest(targetPath)) === sourceDigest) return targetPath;
		throw new Error(`Plugin cache snapshot collision: ${targetPath}`);
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}

	await fs.mkdir(cacheDir, { recursive: true });
	const stagingPath = `${targetPath}.staging-${process.pid}-${randomUUID()}`;
	try {
		await fs.cp(sourcePath, stagingPath, { recursive: true });
		if ((await pluginTreeDigest(stagingPath)) !== sourceDigest) {
			throw new Error("Plugin source changed while its immutable cache snapshot was being created");
		}
		try {
			await fs.rename(stagingPath, targetPath);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
			if ((await pluginTreeDigest(targetPath)) !== sourceDigest) {
				throw new Error(`Plugin cache snapshot collision: ${targetPath}`);
			}
		}
	} finally {
		await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
	}
	return targetPath;
}

/**
 * Synchronous check — true when the cache directory exists on disk.
 * Uses `existsSync` because callers may need to run this check inline without async.
 */
export function isCached(cacheDir: string, marketplace: string, pluginName: string, version: string): boolean {
	const targetPath = getCachedPluginPath(cacheDir, marketplace, pluginName, version);
	return nodeFs.existsSync(targetPath);
}

/** Remove a single cached plugin directory. No-op if it does not exist. */
export async function removeCachedPlugin(
	cacheDir: string,
	marketplace: string,
	pluginName: string,
	version: string,
): Promise<void> {
	const targetPath = getCachedPluginPath(cacheDir, marketplace, pluginName, version);
	await fs.rm(targetPath, { recursive: true, force: true });
}

/**
 * Remove all cache entries whose full path is not in `installedPaths`.
 *
 * Returns the count of removed directories. If `cacheDir` does not exist,
 * returns `{ removed: 0 }` rather than throwing.
 */
export async function cleanOrphanedCache(cacheDir: string, installedPaths: Set<string>): Promise<{ removed: number }> {
	let entries: string[];
	try {
		entries = await fs.readdir(cacheDir);
	} catch (err) {
		if (isEnoent(err)) return { removed: 0 };
		throw err;
	}

	let removed = 0;
	for (const entry of entries) {
		const fullPath = path.join(cacheDir, entry);
		if (!installedPaths.has(fullPath)) {
			await fs.rm(fullPath, { recursive: true, force: true });
			removed++;
		}
	}

	return { removed };
}
