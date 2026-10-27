import { closeSync, constants, lstatSync, openSync, writeSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
/** Keys are private runtime artifacts, excluded from sanitized evidence. */
export function openPrivateTlsKeyLog(path: string) {
	if (!isAbsolute(path)) throw new Error("TLS key file requires an absolute path");
	const parent = lstatSync(dirname(path));
	if (
		!parent.isDirectory() ||
		parent.isSymbolicLink() ||
		(parent.mode & 0o077) !== 0 ||
		parent.uid !== process.getuid?.()
	)
		throw new Error("TLS key directory must be private and owned");
	const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
	let bytes = 0;
	let closed = false;
	return {
		write(line: Buffer) {
			if (closed) throw new Error("TLS key capture closed");
			if (bytes + line.length > 1048576) throw new Error("TLS key capture bounds exceeded");
			let offset = 0;
			while (offset < line.length) {
				const n = writeSync(fd, line, offset, line.length - offset);
				if (n <= 0) throw new Error("TLS key write failed");
				offset += n;
			}
			bytes += line.length;
		},
		close() {
			if (!closed) {
				closed = true;
				closeSync(fd);
			}
		},
	};
}
