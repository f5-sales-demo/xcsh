import { expect, test } from "bun:test";
import { join } from "node:path";

test("managed extension approvals reach the phone and honor its decision", async () => {
	const child = Bun.spawn(
		[process.execPath, "test", join(import.meta.dir, "fixtures/managed-extension-approval.fixture.ts")],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) console.error(stdout, stderr);
	expect(code).toBe(0);
}, 60000);
