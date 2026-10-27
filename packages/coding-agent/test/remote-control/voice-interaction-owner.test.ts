import { expect, test } from "bun:test";
import { join } from "node:path";

test("speech and UI share the session interaction owner without leaking provider mocks", async () => {
	const child = Bun.spawn(
		[process.execPath, "test", join(import.meta.dir, "fixtures/voice-interaction-owner.fixture.ts")],
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
}, 60_000);
