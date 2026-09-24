import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

describe("plugin CLI integration loading", () => {
	let tempHome = "";
	let tempProject = "";

	afterEach(async () => {
		if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
		if (tempProject) await fs.rm(tempProject, { recursive: true, force: true });
	});

	test("loads integrations from an enabled installed marketplace plugin in a fresh process", async () => {
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-cli-home-"));
		tempProject = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-cli-project-"));
		const pluginRoot = path.join(tempHome, "plugin-cache", "xorg");
		await fs.mkdir(path.join(pluginRoot, "extensions"), { recursive: true });
		await fs.mkdir(path.join(tempHome, ".xcsh", "plugins"), { recursive: true });
		await fs.writeFile(
			path.join(pluginRoot, "package.json"),
			JSON.stringify({ name: "xorg", version: "1.0.1", xcsh: { extensions: ["extensions/integration.ts"] } }),
		);
		await fs.writeFile(
			path.join(pluginRoot, "extensions", "integration.ts"),
			`export default function (xcsh) {
				xcsh.integrations.register({
					id: "xorg",
					name: "Xorg",
					plugin: "xorg@test-marketplace",
					kind: "local",
					probe: async () => ({ state: "ready", value: { version: "1.0.1" } }),
				});
			}`,
		);
		await fs.writeFile(
			path.join(tempHome, ".xcsh", "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"xorg@test-marketplace": [
						{
							scope: "user",
							installPath: pluginRoot,
							version: "1.0.1",
							installedAt: "2026-09-21T00:00:00Z",
							lastUpdated: "2026-09-21T00:00:00Z",
						},
					],
				},
			}),
		);

		const child = Bun.spawn(
			[process.execPath, new URL("../src/cli.ts", import.meta.url).pathname, "plugin", "status", "xorg", "--json"],
			{
				cwd: tempProject,
				env: { ...process.env, HOME: tempHome },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);

		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({
			integrations: [{ id: "xorg", plugin: "xorg@test-marketplace", state: "ready" }],
		});
	});
});
