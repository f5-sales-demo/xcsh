import { expect, test } from "bun:test";
import { join } from "node:path";

test("native graceful closure keeps transport mocks isolated", async () => {
	const child = Bun.spawn([process.execPath, "test", join(import.meta.dir, "fixtures/native-closing.fixture.ts")], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) console.error(stdout, stderr);
	expect(code).toBe(0);
}, 30000);
