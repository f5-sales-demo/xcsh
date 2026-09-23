import * as fs from "node:fs";
import * as path from "node:path";

const contentCache = new Map<string, string | null>();
const dirCache = new Map<string, fs.Dirent[]>();

function resolvePath(filePath: string): string {
	return path.resolve(filePath);
}

export async function readFile(filePath: string, signal?: AbortSignal): Promise<string | null> {
	const abs = resolvePath(filePath);
	if (contentCache.has(abs)) {
		return contentCache.get(abs) ?? null;
	}

	try {
		signal?.throwIfAborted();
		const stat = await fs.promises.stat(abs);
		if (!stat.isFile()) return null;
		const content = await fs.promises.readFile(abs, { encoding: "utf8", signal });
		contentCache.set(abs, content);
		return content;
	} catch (error) {
		if (signal?.aborted) throw error;
		contentCache.set(abs, null);
		return null;
	}
}

export async function readDirEntries(dirPath: string, signal?: AbortSignal): Promise<fs.Dirent[]> {
	const abs = resolvePath(dirPath);
	if (dirCache.has(abs)) {
		return dirCache.get(abs) ?? [];
	}

	try {
		signal?.throwIfAborted();
		const entries = await fs.promises.readdir(abs, { withFileTypes: true });
		signal?.throwIfAborted();
		dirCache.set(abs, entries);
		return entries;
	} catch (error) {
		if (signal?.aborted) throw error;
		dirCache.set(abs, []);
		return [];
	}
}

export async function readDir(dirPath: string, signal?: AbortSignal): Promise<string[]> {
	const entries = await readDirEntries(dirPath, signal);
	return entries.map(entry => entry.name);
}

export async function walkUp(
	startDir: string,
	name: string,
	opts: { file?: boolean; dir?: boolean } = {},
	signal?: AbortSignal,
): Promise<string | null> {
	const { file = true, dir = true } = opts;
	let current = resolvePath(startDir);

	while (true) {
		signal?.throwIfAborted();
		const entries = await readDirEntries(current, signal);
		const entry = entries.find(e => e.name === name);
		if (entry) {
			if (file && entry.isFile()) return path.join(current, name);
			if (dir && entry.isDirectory()) return path.join(current, name);
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * Walk up from startDir looking for a `.git` entry (file or directory).
 * Returns the directory containing `.git` (the repo root), or null if not in a git repo.
 * Results are based on the cached readDirEntries, so repeated calls are cheap.
 */
export async function findRepoRoot(startDir: string, signal?: AbortSignal): Promise<string | null> {
	let current = resolvePath(startDir);
	while (true) {
		signal?.throwIfAborted();
		const entries = await readDirEntries(current, signal);
		if (entries.some(e => e.name === ".git")) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function cacheStats(): { content: number; dir: number } {
	return {
		content: contentCache.size,
		dir: dirCache.size,
	};
}

export function clearCache(): void {
	contentCache.clear();
	dirCache.clear();
}

export function invalidate(filePath: string): void {
	const abs = resolvePath(filePath);
	contentCache.delete(abs);
	dirCache.delete(abs);
	const parent = path.dirname(abs);
	if (parent !== abs) {
		dirCache.delete(parent);
	}
}
