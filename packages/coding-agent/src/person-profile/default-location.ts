import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve only the established default profile root. Explicit store paths
 * retain their strict no-symlink contract. An untrusted or changing alias is
 * left untouched so the private store reports its existing refusal. */
export function defaultProfilePath(filename: "user-profile.json" | "computer-profile.json"): string {
	const root = join(homedir(), ".xcsh");
	const original = join(root, filename);
	try {
		const before = lstatSync(root, { bigint: true });
		if (!before.isSymbolicLink()) return original;
		const uid = process.getuid?.();
		if (uid === undefined || (before.uid !== BigInt(uid) && before.uid !== 0n)) return original;
		const canonical = realpathSync(root);
		const target = lstatSync(canonical, { bigint: true });
		if (
			!target.isDirectory() ||
			target.isSymbolicLink() ||
			target.uid !== BigInt(uid) ||
			(target.mode & 0o077n) !== 0n
		)
			return original;
		const after = lstatSync(root, { bigint: true });
		if (
			!["dev", "ino", "uid", "mode", "mtimeNs", "ctimeNs"].every(
				key => before[key as keyof typeof before] === after[key as keyof typeof after],
			) ||
			realpathSync(root) !== canonical
		)
			return original;
		const current = lstatSync(canonical, { bigint: true });
		if (
			!["dev", "ino", "uid", "mode"].every(
				key => target[key as keyof typeof target] === current[key as keyof typeof current],
			)
		)
			return original;
		return join(canonical, filename);
	} catch {
		return original;
	}
}
