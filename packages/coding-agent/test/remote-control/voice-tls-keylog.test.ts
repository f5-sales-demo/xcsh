import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPrivateTlsKeyLog } from "../../src/remote-control/voice-tls-keylog";

test("TLS session keys use a private exclusive file with a bounded lifetime", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-keylog-"));
	await chmod(root, 0o700);
	const path = join(root, "keys.log");
	try {
		const log = openPrivateTlsKeyLog(path);
		log.write(Buffer.from("synthetic key line\n"));
		log.close();
		log.close();
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(await readFile(path, "utf8")).toBe("synthetic key line\n");
		expect(() => openPrivateTlsKeyLog(path)).toThrow();
		expect(() => log.write(Buffer.from("late"))).toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("TLS session keys reject shared directories and oversized output", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-keylog-"));
	try {
		await chmod(root, 0o755);
		expect(() => openPrivateTlsKeyLog(join(root, "shared"))).toThrow();
		await chmod(root, 0o700);
		const log = openPrivateTlsKeyLog(join(root, "bounded"));
		try {
			expect(() => log.write(Buffer.alloc(1048577))).toThrow();
		} finally {
			log.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
