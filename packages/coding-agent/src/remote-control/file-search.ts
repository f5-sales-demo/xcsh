import { readdir, realpath } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { type Notification, ProtocolError } from "./session";

type Search = { roots: string[]; revision: number };
export class RemoteFileSearch {
	#clients = new Map<string, Map<string, Search>>();
	constructor(private emit: (client: string, event: Notification) => void) {}
	close(client?: string): void {
		if (client === undefined) this.#clients.clear();
		else this.#clients.delete(client);
	}
	async call(client: string, method: string, p: Record<string, unknown>, allowed: string[]): Promise<object> {
		if (typeof p.sessionId !== "string" || !p.sessionId || p.sessionId.length > 256)
			throw new ProtocolError(-32602, "Invalid file search session");
		const sessions = this.#clients.get(client) ?? new Map<string, Search>();
		if (method === "fuzzyFileSearch/sessionStart") {
			if (
				!Array.isArray(p.roots) ||
				!p.roots.length ||
				p.roots.length > 8 ||
				p.roots.some(root => typeof root !== "string" || !allowed.includes(root) || root === "/")
			)
				throw new ProtocolError(-32602, "Search roots must be selected workspaces");
			if (sessions.size >= 16 && !sessions.has(p.sessionId))
				throw new ProtocolError(-32000, "File search session limit");
			sessions.set(p.sessionId, { roots: p.roots as string[], revision: 0 });
			this.#clients.set(client, sessions);
			return {};
		}
		const search = sessions.get(p.sessionId);
		if (!search) throw new ProtocolError(-32602, "File search session not found");
		if (method === "fuzzyFileSearch/sessionStop") {
			sessions.delete(p.sessionId);
			if (!sessions.size) this.#clients.delete(client);
			return {};
		}
		if (typeof p.query !== "string" || p.query.length > 1024)
			throw new ProtocolError(-32602, "Invalid file search query");
		const revision = ++search.revision;
		const query = p.query;
		const id = p.sessionId;
		void this.#search(search.roots, query)
			.then(files => {
				setTimeout(() => {
					if (this.#clients.get(client)?.get(id) !== search || revision !== search.revision) return;
					this.emit(client, { method: "fuzzyFileSearch/sessionUpdated", params: { sessionId: id, query, files } });
					this.emit(client, { method: "fuzzyFileSearch/sessionCompleted", params: { sessionId: id } });
				}, 0);
			})
			.catch(() => {
				if (this.#clients.get(client)?.get(id) === search && revision === search.revision)
					this.emit(client, { method: "error", params: { message: "Could not search workspace files" } });
			});
		return {};
	}
	async #search(roots: string[], query: string): Promise<object[]> {
		const files: {
			root: string;
			path: string;
			file_name: string;
			match_type: string;
			score: number;
			indices: number[];
		}[] = [];
		let visited = 0;
		const started = Date.now();
		for (const root of roots) {
			const base = await realpath(root);
			const pending = [{ path: base, depth: 0 }];
			while (pending.length && visited < 10000 && Date.now() - started < 5000) {
				const dir = pending.shift()!;
				const resolved = await realpath(dir.path);
				if (resolved !== base && !resolved.startsWith(`${base}/`)) continue;
				const entries = await readdir(resolved, { withFileTypes: true });
				for (const entry of entries) {
					if (++visited > 10000) throw new Error("File search index limit exceeded");
					if (entry.name === ".git" || entry.isSymbolicLink()) continue;
					const absolute = join(dir.path, entry.name);
					const path = relative(base, absolute).replaceAll("\\", "/");
					if (entry.isDirectory()) {
						if (dir.depth >= 16) throw new Error("File search depth limit exceeded");
						pending.push({ path: absolute, depth: dir.depth + 1 });
					}
					if (!entry.isFile() && !entry.isDirectory()) continue;
					const indices: number[] = [];
					const haystack = path.toLocaleLowerCase();
					let cursor = 0;
					for (const char of query.toLocaleLowerCase()) {
						const found = haystack.indexOf(char, cursor);
						if (found < 0) {
							indices.length = 0;
							break;
						}
						indices.push(found);
						cursor = found + 1;
					}
					if (query && indices.length !== [...query].length) continue;
					files.push({
						root,
						path,
						file_name: basename(path),
						match_type: entry.isDirectory() ? "directory" : "file",
						score: Math.max(0, 1000 - path.length),
						indices,
					});
				}
			}
			if (pending.length) throw new Error("File search index budget exceeded");
		}
		return files.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 100);
	}
}
