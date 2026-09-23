import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadIntegrationHandles } from "../src/cli/plugin-cli";
import { clearXcshPluginRootsCache } from "../src/discovery/helpers";
import { integrationRegistry } from "../src/integrations/registry";

describe("plugin CLI integration loading", () => {
	let tempHome = "";
	let tempProject = "";

	beforeEach(() => {
		integrationRegistry.clear();
		clearXcshPluginRootsCache();
	});

	afterEach(async () => {
		integrationRegistry.clear();
		clearXcshPluginRootsCache();
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

		const handles = await loadIntegrationHandles(tempHome, tempProject);

		expect(handles.map(handle => handle.id)).toContain("xorg");
		expect((await handles.find(handle => handle.id === "xorg")?.get())?.state).toBe("ready");
	});
});
