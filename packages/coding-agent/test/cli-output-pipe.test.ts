import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const cli = path.resolve(import.meta.dir, "../src/cli.ts");
test("help exits cleanly when the downstream reader closes early", async () => {
	const child = Bun.spawn(["bash", "-c", 'set -o pipefail; "$1" "$2" --help | head -1', "--", process.execPath, cli], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(stdout).toContain("xcsh");
	expect(stderr).not.toContain("EPIPE");
	expect(stderr).not.toContain("Unhandled");
	expect(code).toBe(0);
});

test("real stdout errors remain fatal and reported", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-output-error-"));
	try {
		const preload = path.join(dir, "error.ts");
		await fs.writeFile(
			preload,
			'setTimeout(() => process.stdout.emit("error", Object.assign(new Error("synthetic output failure"), { code: "EIO" })), 0);',
		);
		const child = Bun.spawn([process.execPath, "--preload", preload, cli, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code).not.toBe(0);
		expect(stderr).toContain("synthetic output failure");
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
