import { expect, test } from "bun:test";
import { join } from "node:path";

test("native startup honors controls through an isolated media fixture", async () => {
	const child = Bun.spawn(
		[process.execPath, "test", join(import.meta.dir, "fixtures/native-start-controls.fixture.ts")],
		{
			env: {
				...Bun.env,
				SSH_CONNECTION: undefined,
				XCSH_VOICE_PACKAGE_DIR: "/fixture/package",
				XCSH_VOICE_PACKAGE_SHA256: "0".repeat(64),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (code !== 0) console.error(stdout, stderr);
	expect(code).toBe(0);
}, 60_000);
