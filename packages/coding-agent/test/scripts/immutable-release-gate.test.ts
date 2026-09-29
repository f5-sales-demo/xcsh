import { expect, test } from "bun:test";
import * as path from "node:path";

test("immutable release gate handles throttling and preserves fail-closed readback", async () => {
	const repositoryRoot = path.resolve(import.meta.dir, "../../../..");
	const process = Bun.spawn(["node", "--test", "tests/test-enable-immutable-releases.cjs"], {
		cwd: repositoryRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	expect(code, `${stdout}\n${stderr}`).toBe(0);
});
