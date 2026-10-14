import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { clearXcshPluginRootsCache } from "../src/discovery/helpers";
import { discoverAndLoadExtensions } from "../src/extensibility/extensions/loader";
import type { ExtensionRunner } from "../src/extensibility/extensions/runner";
import { wrapRegisteredTool } from "../src/extensibility/extensions/wrapper";
import { CustomMessageComponent } from "../src/modes/components/custom-message";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { initTheme } from "../src/modes/theme/theme";

// This integration gate is run explicitly against the coordinated marketplace checkout.
const root = process.env.XCSH_PRESENTATION_MARKETPLACE_ROOT;
describe.skipIf(!root)("full marketplace presentation through installed-plugin discovery", () => {
	let home: string;
	const originalPath = process.env.PATH;
	afterEach(async () => {
		clearXcshPluginRootsCache({ rewarm: false });
		process.env.PATH = originalPath;
		if (home) await rm(home, { recursive: true, force: true });
	});
	test("all 23 catalog surfaces and every loaded tool use the active theme", async () => {
		await initTheme();
		home = await mkdtemp(join(tmpdir(), "xcsh-plugin-view-"));
		await mkdir(join(home, ".xcsh", "plugins"), { recursive: true });
		const catalog = await Bun.file(join(root!, ".xcsh-plugin", "marketplace.json")).json();
		expect(catalog.plugins).toHaveLength(23);
		const plugins = Object.fromEntries(
			catalog.plugins.map((plugin: { name: string; source: string; version: string }) => [
				`${plugin.name}@fixture`,
				[{ scope: "user", installPath: resolve(root!, plugin.source), version: plugin.version }],
			]),
		);
		await writeFile(
			join(home, ".xcsh", "plugins", "installed_plugins.json"),
			JSON.stringify({ version: 2, plugins }),
		);
		// No tool or integration probe may launch a real cloud/host command in this gate.
		const which = spyOn(Bun, "which").mockImplementation(name => `/synthetic/${name}`);
		const spawn = spyOn(Bun, "spawnSync").mockReturnValue({
			exitCode: 0,
			stdout: new TextEncoder().encode("{}"),
			stderr: new Uint8Array(),
		} as never);
		try {
			const result = await discoverAndLoadExtensions([], home, undefined, [], home);
			expect(result.errors).toEqual([]);
			const tools = result.extensions
				.filter(extension => extension.path.startsWith(root!))
				.flatMap(extension => [...extension.tools.values()]);
			expect(tools.length).toBeGreaterThan(40);
			expect(tools.filter(tool => tool.definition.name.startsWith("sf_"))).toHaveLength(6);
			for (const registered of tools) {
				expect(registered.definition.presentation).toBeDefined();
				const tool = wrapRegisteredTool(registered, {} as ExtensionRunner);
				const component = new ToolExecutionComponent(tool.name, { count: 0, enabled: false }, {}, tool, {
					requestRender() {},
				} as TUI);
				component.updateResult({
					content: [
						{
							type: "text",
							text: JSON.stringify({ records: [{ total: 0, enabled: false, missing: null }], done: false }),
						},
					],
				});
				for (const width of [40, 76, 120, 153]) {
					const lines = component.render(width);
					expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
					expect(lines.join("\n")).toContain("total");
				}
			}
			for (const plugin of catalog.plugins) {
				const manifest = await Bun.file(join(root!, plugin.source, ".xcsh-plugin", "plugin.json")).json();
				expect(manifest.lifecycle).toBeDefined();
				const message = new CustomMessageComponent({
					customType: plugin.name,
					content: `**${plugin.name}**\n\n| Status | Total |\n| --- | ---: |\n| ready | 0 |`,
					display: true,
				} as never);
				expect(message.render(40).every(line => visibleWidth(line) <= 40)).toBe(true);
			}
		} finally {
			which.mockRestore();
			spawn.mockRestore();
		}
	});
});
