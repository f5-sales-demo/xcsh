import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CliConfig } from "@f5-sales-demo/pi-utils/cli";
import { $ } from "bun";
import Plugin from "../src/commands/plugin";

const cli = path.resolve(import.meta.dir, "../src/cli.ts");

const TEST_CONFIG: CliConfig = {
	bin: "xcsh",
	version: "0.0.0-test",
	commands: new Map(),
};

describe("Plugin command scope parsing", () => {
	it("rejects machine output for human-only setup without an exception trace", async () => {
		const result = await $`${process.execPath} ${cli} plugin setup herdr --json`.quiet().nothrow();
		const stderr = result.stderr.toString();
		expect(result.exitCode).toBe(2);
		expect(stderr).toContain("plugin setup is human-only and does not accept --json");
		expect(stderr).not.toContain("Uncaught Exception");
		expect(stderr).not.toContain("plugin-cli.ts");
	});

	it("accepts project scope", async () => {
		const command = new Plugin(["install", "--scope", "project"], TEST_CONFIG);
		const { flags } = await command.parse(Plugin);
		expect(flags.scope).toBe("project");
	});

	it("accepts an explicit saved context for integration status", async () => {
		const command = new Plugin(["status", "kvm", "--context", "f5-amer-ent", "--json"], TEST_CONFIG);
		const { flags } = await command.parse(Plugin);
		expect(flags.context).toBe("f5-amer-ent");
	});

	it("uses an explicit saved context without persisting global activation or printing its token", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-context-"));
		const xdgConfig = path.join(root, "config");
		const contextsDir = path.join(xdgConfig, "xcsh", "contexts");
		await mkdir(contextsDir, { recursive: true });
		await Bun.write(
			path.join(contextsDir, "uat.json"),
			JSON.stringify({
				name: "uat",
				apiUrl: "https://example.console.ves.volterra.io",
				apiToken: "test-token-do-not-print",
				defaultNamespace: "system",
				version: 1,
				metadata: { createdAt: "2026-09-25T00:00:00.000Z" },
			}),
		);
		const env: Record<string, string | undefined> = { ...process.env, HOME: root, XDG_CONFIG_HOME: xdgConfig };
		delete env.XCSH_API_URL;
		delete env.XCSH_API_TOKEN;
		delete env.XCSH_NAMESPACE;
		try {
			const result = await $`${process.execPath} ${cli} plugin status --context uat --json`
				.env(env)
				.cwd(root)
				.quiet()
				.nothrow();
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toEqual({ integrations: [] });
			expect(result.stdout.toString()).not.toContain("test-token-do-not-print");
			expect(await Bun.file(path.join(xdgConfig, "xcsh", "active_context")).exists()).toBe(false);

			const missing = await $`${process.execPath} ${cli} plugin status --context missing --json`
				.env(env)
				.cwd(root)
				.quiet()
				.nothrow();
			expect(missing.exitCode).toBe(2);
			expect(missing.stderr.toString()).toContain("Context not found");
			expect(missing.stderr.toString()).not.toContain("Uncaught Exception");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects invalid scope values", async () => {
		const command = new Plugin(["install", "--scope", "porject-INVALID"], TEST_CONFIG);
		await expect(command.parse(Plugin)).rejects.toThrow(/Expected --scope to be one of: user, project/);
	});
});
