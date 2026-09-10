import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("remote CLI defaults off and exposes explicit host controls", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-remote-cli-"));
	try {
		const command = async (args: string[]) => {
			const child = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", ...args], {
				cwd: join(import.meta.dir, "../.."),
				env: { ...process.env, PI_CODING_AGENT_DIR: dir },
				stdout: "pipe",
				stderr: "pipe",
			});
			return {
				stdout: await new Response(child.stdout).text(),
				stderr: await new Response(child.stderr).text(),
				code: await child.exited,
			};
		};
		const status = await command(["status", "--json"]);
		expect(status.code).toBe(0);
		expect(JSON.parse(status.stdout)).toMatchObject({ enabled: false, relay: "stopped", liveSessions: 0 });
		const help = await command(["--help"]);
		expect(help.stdout).toContain("remote-control");
		expect(help.stdout).toContain("pair");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
