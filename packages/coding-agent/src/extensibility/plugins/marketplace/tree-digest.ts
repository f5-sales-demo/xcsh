import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function directoryDigest(root: string, excluded: ReadonlySet<string> = new Set()): Promise<string> {
	const hash = createHash("sha256");
	const visit = async (directory: string, prefix = ""): Promise<void> => {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (excluded.has(entry.name)) continue;
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
