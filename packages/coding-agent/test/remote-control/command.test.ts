import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each(["status", "help"] as const)(
	"remote CLI %s defaults off and exposes explicit host controls",
	async surface => {
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
			if (surface === "status") {
				const status = await command(["status", "--json"]);
				expect(status.code).toBe(0);
				expect(JSON.parse(status.stdout)).toMatchObject({ enabled: false, relay: "stopped", liveSessions: 0 });
			} else {
				const help = await command(["--help"]);
				expect(help.code).toBe(0);
				expect(help.stdout).toContain("remote-control");
				expect(help.stdout).toContain("pair");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);

test("remote client controls are discoverable and reject revoke without an explicit client identity", async () => {
	const { default: RemoteControl } = await import("../../src/commands/remote-control");
	expect(RemoteControl.description).toContain("clients");
	expect(RemoteControl.description).toContain("revoke");
	const { runRemoteControl } = await import("../../src/remote-control/control");
	await expect(runRemoteControl("revoke")).rejects.toThrow("client identity");
});

test("isolated CLI exercises every management action without ambient remote state", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-remote-actions-"));
	const command = async (args: readonly string[]) => {
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
	try {
		const disabled = await command(["disable", "--json"]);
		expect(disabled.code).toBe(0);
		expect(JSON.parse(disabled.stdout)).toEqual({ enabled: false });

		for (const [args, message] of [
			[["enable"], "Remote enrollment requires a selected xcsh ChatGPT subscription"],
			[["pair"], "Enable xcsh remote control first"],
			[["clients"], "Enroll an xcsh remote host before managing its clients"],
			[["revoke", "fixture-client"], "Enroll an xcsh remote host before managing its clients"],
		] as const) {
			const result = await command(args);
			expect(result.code).not.toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(message);
			expect(result.stderr).not.toContain("fixture-token");
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
