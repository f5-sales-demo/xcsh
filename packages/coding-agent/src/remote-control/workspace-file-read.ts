import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { ProtocolError } from "./session";

export async function readWorkspaceFile(path: string, roots: readonly string[]): Promise<{ dataBase64: string }> {
	const within = (root: string, file: string) => {
		const rel = relative(root, file);
		return root !== "/" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
	};
	if (!roots.some(root => within(root, path)))
		throw new ProtocolError(-32602, "File is outside selected session workspaces");
	let resolved: string;
	try {
		resolved = await realpath(path);
	} catch {
		throw new ProtocolError(-32000, "Could not read workspace file");
	}
	const allowed = await Promise.all(
		roots
			.filter(root => root !== "/")
			.map(async root => {
				const base = await realpath(root).catch(() => "");
				if (!base) return false;
				const rel = relative(base, resolved);
				return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
			}),
	);
	if (!allowed.some(Boolean)) throw new ProtocolError(-32602, "File is outside selected session workspaces");
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		const info = await stat(resolved);
		if (!info.isFile() || info.size > 2 * 1024 * 1024)
			throw new ProtocolError(-32602, "Workspace file is unavailable or too large");
		handle = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size > 2 * 1024 * 1024)
			throw new ProtocolError(-32602, "Workspace file is unavailable or too large");
		const actual = await realpath(`/proc/self/fd/${handle.fd}`);
		if (actual !== resolved) throw new ProtocolError(-32602, "Workspace file changed during read");
		const bytes = Buffer.alloc(opened.size);
		let offset = 0;
		while (offset < bytes.length) {
			const read = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (!read.bytesRead) break;
			offset += read.bytesRead;
		}
		return { dataBase64: bytes.subarray(0, offset).toString("base64") };
	} catch (error) {
		if (error instanceof ProtocolError) throw error;
		throw new ProtocolError(-32000, "Could not read workspace file");
	} finally {
		await handle?.close();
	}
}
