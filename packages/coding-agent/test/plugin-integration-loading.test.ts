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

	test("loads Salesforce-shaped package extensions and setup plans in a fresh process", async () => {
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-cli-home-"));
		tempProject = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-cli-project-"));
		const pluginRoot = path.join(tempHome, "plugin-cache", "salesforce");
		await fs.mkdir(path.join(pluginRoot, "extensions"), { recursive: true });
		await fs.mkdir(path.join(pluginRoot, ".xcsh-plugin"), { recursive: true });
		await fs.mkdir(path.join(tempHome, ".xcsh", "plugins"), { recursive: true });
		await fs.writeFile(
			path.join(pluginRoot, "package.json"),
			JSON.stringify({ name: "salesforce", version: "1.5.0", xcsh: { extensions: ["extensions/integration.ts"] } }),
		);
		await fs.writeFile(
			path.join(pluginRoot, ".xcsh-plugin", "plugin.json"),
			JSON.stringify({
				name: "salesforce",
				version: "1.5.0",
				lifecycle: { integrations: ["salesforce"], setupRequired: true },
			}),
		);
		await fs.writeFile(
			path.join(pluginRoot, "extensions", "integration.ts"),
			`export default function (xcsh) {
				xcsh.integrations.register({
					id: "salesforce",
					name: "Salesforce",
					plugin: "salesforce@test-marketplace",
					kind: "network",
					setup: { pluginDependencies: [], requiredEnvironment: [], profileFields: [], steps: [], verification: [], guidedAction: { kind: "context_wizard" } },
					probe: async () => ({ state: "setup_required", reason: "Salesforce authentication is required" }),
				});
			}`,
		);
		await fs.writeFile(
			path.join(tempHome, ".xcsh", "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"salesforce@test-marketplace": [
						{
							scope: "user",
							installPath: pluginRoot,
							version: "1.5.0",
							installedAt: "2026-09-21T00:00:00Z",
							lastUpdated: "2026-09-21T00:00:00Z",
						},
					],
				},
			}),
		);

		const child = Bun.spawn(
			[
				process.execPath,
				new URL("../src/cli.ts", import.meta.url).pathname,
				"plugin",
				"status",
				"salesforce",
				"--json",
			],
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
			integrations: [{ id: "salesforce", plugin: "salesforce@test-marketplace", state: "setup_required" }],
		});

		// Integration registration belongs to the process that loads the plugin. Keep
		// this isolated-home check in its own process, just like the CLI check above.
		const probe = Bun.spawn(
			[
				process.execPath,
				"-e",
				`const {loadIntegrationHandles,selectSetupIntegration}=await import(${JSON.stringify(new URL("../src/cli/plugin-cli.ts", import.meta.url).pathname)});const handles=await loadIntegrationHandles(process.argv[1],process.argv[2]);console.log(JSON.stringify({id:selectSetupIntegration(handles,"salesforce").id}));`,
				tempHome,
				tempProject,
			],
			{ cwd: tempProject, env: { ...process.env, HOME: tempHome }, stdout: "pipe", stderr: "pipe" },
		);
		const [probeCode, probeOut, probeErr] = await Promise.all([
			probe.exited,
			new Response(probe.stdout).text(),
			new Response(probe.stderr).text(),
		]);
		expect(probeCode, probeErr).toBe(0);
		expect(JSON.parse(probeOut)).toEqual({ id: "salesforce" });
	});
});
