import { lstat, mkdir, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { ProtocolError } from "./errors";

export type FolderPickerMethod = "fs/getMetadata" | "fs/readDirectory" | "fs/createDirectory";

/** Pinned App Server filesystem operations used by the phone project picker. */
export async function folderPickerRequest(method: FolderPickerMethod, params: Record<string, unknown>) {
	const path = params.path;
	if (typeof path !== "string" || path.includes("\u0000") || !isAbsolute(path) || normalize(path) !== path)
		throw new ProtocolError(-32602, "Folder path must be absolute and normalized");
	if (method === "fs/createDirectory" && params.recursive != null && typeof params.recursive !== "boolean")
		throw new ProtocolError(-32602, "Directory recursive flag must be boolean or null");
	try {
		if (method === "fs/createDirectory") {
			await mkdir(path, { recursive: params.recursive !== false });
			return {};
		}
		if (method === "fs/getMetadata") {
			const link = await lstat(path);
			const metadata = link.isSymbolicLink() ? await stat(path) : link;
			return {
				isDirectory: metadata.isDirectory(),
				isFile: metadata.isFile(),
				isSymlink: link.isSymbolicLink(),
				createdAtMs: Number.isFinite(metadata.birthtimeMs) ? Math.trunc(metadata.birthtimeMs) : 0,
				modifiedAtMs: Number.isFinite(metadata.mtimeMs) ? Math.trunc(metadata.mtimeMs) : 0,
			};
		}
		const entries = await readdir(path, { withFileTypes: true });
		return {
			entries: await Promise.all(
				entries.map(async entry => {
					let isDirectory = entry.isDirectory(),
						isFile = entry.isFile();
					if (entry.isSymbolicLink()) {
						try {
							const metadata = await stat(join(path, entry.name));
							isDirectory = metadata.isDirectory();
							isFile = metadata.isFile();
						} catch {
							/* Unresolved symlinks remain listable names, as in the pinned filesystem. */
						}
					}
					return { fileName: entry.name, isDirectory, isFile };
				}),
			),
		};
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		throw new ProtocolError(-32603, `Filesystem operation failed${code ? ` (${code})` : ""}`);
	}
}
