import { describe, expect, it } from "bun:test";
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

	it("rejects invalid scope values", async () => {
		const command = new Plugin(["install", "--scope", "porject-INVALID"], TEST_CONFIG);
		await expect(command.parse(Plugin)).rejects.toThrow(/Expected --scope to be one of: user, project/);
	});
});
