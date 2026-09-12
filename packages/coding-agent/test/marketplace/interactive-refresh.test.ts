import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..");
const FIXTURE_DIR = path.join(import.meta.dir, "fixtures", "valid-marketplace");
const tempRoots: string[] = [];

function makeEnvironment(): { home: string; source: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-interactive-refresh-"));
	tempRoots.push(root);
	const home = path.join(root, "home");
	const source = path.join(root, "marketplace");
	fs.mkdirSync(home, { recursive: true });
	fs.cpSync(FIXTURE_DIR, source, { recursive: true });
	return { home, source };
}

function setSourceVersion(source: string, version: string): void {
	const catalogPath = path.join(source, ".xcsh-plugin", "marketplace.json");
	const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
		plugins: Array<{ version?: string }>;
	};
	catalog.plugins[0].version = version;
	fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

async function runScript(
	code: string,
	home: string,
	source: string,
	timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
	const script = `await (await import("./src/modes/theme/theme")).setTheme("xcsh-dark");\n${code}`;
	const proc = Bun.spawn([process.execPath, "-e", script], {
		cwd: PACKAGE_ROOT,
		env: { ...process.env, HOME: home, TEST_MARKETPLACE_SOURCE: source },
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const deadline = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (timedOut) throw new Error(`Marketplace fixture subprocess exceeded ${timeoutMs}ms: ${stderr || stdout}`);
		return { stdout, stderr, code: exitCode };
	} finally {
		clearTimeout(deadline);
	}
}

const ADD_MARKETPLACE = `
	import {
		getInstalledPluginsRegistryPath,
		getMarketplacesCacheDir,
		getMarketplacesRegistryPath,
		getPluginsCacheDir,
		MarketplaceManager,
	} from "./src/extensibility/plugins/marketplace";
	const manager = new MarketplaceManager({
		marketplacesRegistryPath: getMarketplacesRegistryPath(),
		installedRegistryPath: getInstalledPluginsRegistryPath(),
		marketplacesCacheDir: getMarketplacesCacheDir(),
		pluginsCacheDir: getPluginsCacheDir(),
	});
	await manager.addMarketplace(process.env.TEST_MARKETPLACE_SOURCE);
`;

afterEach(() => {
	for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("interactive marketplace refresh surfaces", () => {
	// Tests below launch up to four fresh CLI processes. Each child has a 10s deadline;
	// the 60s outer budget lets the helper stop/reap it before afterEach removes fixtures.
	it("reaps a stalled fixture subprocess before reporting its deadline", async () => {
		const { home, source } = makeEnvironment();
		await expect(runScript("await Bun.sleep(60_000);", home, source, 50)).rejects.toThrow("exceeded 50ms");
	});
	it("dashboard actions follow real installation, upgrade, and removal state", async () => {
		const { home, source } = makeEnvironment();
		const result = await runScript(
			`${ADD_MARKETPLACE}
			import { registerLocales } from "@f5-sales-demo/pi-utils";
			import { locales } from "./src/locales/index";
			import { PluginDashboard } from "./src/modes/components/plugins/plugin-dashboard";
			registerLocales(locales);
			const dashboard = await PluginDashboard.create(process.cwd(), 40, "discover");
			const render = () => Bun.stripANSI(dashboard.render(100).join("\\n"));
			const waitFor = async text => {
				for (let i = 0; i < 300; i++) {
					if (render().includes(text)) return;
					await Bun.sleep(10);
				}
				throw new Error("Missing " + text + "\\n" + render());
			};
			const key = value => dashboard.handleInput(value);
			await waitFor("Plugin information is up to date.");
			key("\\r");
			await waitFor("Review installation");
			if (render().includes("Installed version:")) throw new Error("Catalog entry claims to be installed");
			if (render().includes("Remove plugin") || render().includes("Upgrade plugin")) throw new Error("Uninstalled actions wrong");
			key("\\r"); key("\\x1b[B"); key("\\r");
			await waitFor("Installation completed.");
			let installed = await manager.listInstalledPlugins();
			if (installed[0]?.entries[0]?.version !== "1.0.0") throw new Error("Installation did not persist");
			if (!render().includes("Shown in Installed")) throw new Error("Installed target was not retained");
			key("\\r");
			await waitFor("Remove plugin");
			if (render().includes("Review installation") || render().includes("Upgrade plugin")) throw new Error("Installed actions wrong");
			key("\\r"); // disable
			await waitFor("Review enabled state");
			if ((await manager.listInstalledPlugins())[0]?.entries[0]?.enabled === false) throw new Error("Disabled before review");
			key("\\r"); // cancel is initially selected
			if ((await manager.listInstalledPlugins())[0]?.entries[0]?.enabled === false) throw new Error("Cancel changed enabled state");
			key("\\r"); key("\\x1b[B"); key("\\r");
			await waitFor("Disable completed.");
			installed = await manager.listInstalledPlugins();
			if (installed[0]?.entries[0]?.enabled !== false) throw new Error("Disable did not persist");
			key("\\r"); await waitFor("Enable plugin"); key("\\x1b");
			const catalogPath = process.env.TEST_MARKETPLACE_SOURCE + "/.xcsh-plugin/marketplace.json";
			const catalog = await Bun.file(catalogPath).json();
			catalog.plugins[0].version = "2.0.0";
			await Bun.write(catalogPath, JSON.stringify(catalog));
			key("\\x12"); await waitFor("Update 2.0.0");
			key("\\r"); await waitFor("Upgrade plugin");
			key("\\x1b[B"); key("\\x1b[B"); key("\\r");
			await waitFor("Cancel update");
			if ((await manager.listInstalledPlugins())[0]?.entries[0]?.version !== "1.0.0") throw new Error("Update happened before review");
			key("\\x1b[B"); key("\\r");
			await waitFor("Upgrade completed.");
			installed = await manager.listInstalledPlugins();
			if (installed[0]?.entries[0]?.version !== "2.0.0") throw new Error("Upgrade did not persist");
			key("\\r");
			if (render().includes("Upgrade plugin")) throw new Error("Upgrade action remained after upgrade");
			key("\\x1b[B"); key("\\x1b[B"); key("\\r");
			await waitFor("Cancel removal"); key("\\r");
			if ((await manager.listInstalledPlugins()).length !== 1) throw new Error("Cancel removed plugin");
			key("\\x1b[B"); key("\\x1b[B"); key("\\r"); key("\\x1b[B"); key("\\r");
			await waitFor("Removal completed.");
			if ((await manager.listInstalledPlugins()).length !== 0) throw new Error("Removal did not persist");
			key("\\r");
			await waitFor("Review installation");
		`,
			home,
			source,
		);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	}, 60_000);

	it("opening an empty dashboard does not silently configure a default marketplace", async () => {
		const { home, source } = makeEnvironment();
		const result = await runScript(
			`import { registerLocales } from "@f5-sales-demo/pi-utils";
			 import { locales } from "./src/locales/index";
			 import { PluginDashboard } from "./src/modes/components/plugins/plugin-dashboard";
			 import {
			   getInstalledPluginsRegistryPath,
			   getMarketplacesCacheDir,
			   getMarketplacesRegistryPath,
			   getPluginsCacheDir,
			   MarketplaceManager,
			 } from "./src/extensibility/plugins/marketplace";
			 registerLocales(locales);
			 const dashboard = await PluginDashboard.create(process.cwd(), 24);
			 const render = () => Bun.stripANSI(dashboard.render(80).join("\\n"));
			 for (let i = 0; i < 300 && !render().includes("Plugin information is up to date."); i++) await Bun.sleep(10);
			 const manager = new MarketplaceManager({
			   marketplacesRegistryPath: getMarketplacesRegistryPath(),
			   installedRegistryPath: getInstalledPluginsRegistryPath(),
			   marketplacesCacheDir: getMarketplacesCacheDir(),
			   pluginsCacheDir: getPluginsCacheDir(),
			 });
			 if ((await manager.listMarketplaces()).length !== 0) throw new Error("dashboard configured a marketplace without review");
			 if (!render().includes("No plugins are installed")) throw new Error(render());`,
			home,
			source,
		);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	}, 60_000);

	it("dashboard installation rejects a catalog version changed after review without writing", async () => {
		const { home, source } = makeEnvironment();
		const result = await runScript(
			`${ADD_MARKETPLACE}
			 import { registerLocales } from "@f5-sales-demo/pi-utils";
			 import { locales } from "./src/locales/index";
			 import { PluginDashboard } from "./src/modes/components/plugins/plugin-dashboard";
			 registerLocales(locales);
			 const dashboard = await PluginDashboard.create(process.cwd(), 30, "discover");
			 const render = () => Bun.stripANSI(dashboard.render(100).join("\\n"));
			 const waitFor = async text => {
			   for (let i = 0; i < 300; i++) {
			     if (render().includes(text)) return;
			     await Bun.sleep(10);
			   }
			   throw new Error("Missing " + text + "\\n" + render());
			 };
			 await waitFor("Plugin information is up to date.");
			 dashboard.handleInput("\\r");
			 dashboard.handleInput("\\r");
			 await waitFor("Cancel installation");
			 const catalogPath = process.env.TEST_MARKETPLACE_SOURCE + "/.xcsh-plugin/marketplace.json";
			 const catalog = await Bun.file(catalogPath).json();
			 catalog.plugins[0].version = "2.0.0";
			 await Bun.write(catalogPath, JSON.stringify(catalog));
			 dashboard.handleInput("\\x1b[B");
			 dashboard.handleInput("\\r");
			 await waitFor("target changed or is unavailable");
			 if ((await manager.listInstalledPlugins()).length !== 0) throw new Error("changed catalog was installed without renewed review");`,
			home,
			source,
		);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	}, 60_000);

	it("CLI discovery refreshes fresh catalogs and sends stale fallback warnings to stderr", async () => {
		const { home, source } = makeEnvironment();
		expect((await runScript(ADD_MARKETPLACE, home, source)).code).toBe(0);
		setSourceVersion(source, "2.0.0");

		const fresh = await runScript(
			`import { runPluginCommand } from "./src/cli/plugin-cli";
			 await runPluginCommand({ action: "discover", args: ["test-marketplace"], flags: {} });`,
			home,
			source,
		);
		expect(fresh.code).toBe(0);
		expect(fresh.stdout).toContain("hello-plugin@2.0.0");

		fs.rmSync(source, { recursive: true, force: true });
		const offline = await runScript(
			`import { runPluginCommand } from "./src/cli/plugin-cli";
			 await runPluginCommand({ action: "discover", args: ["test-marketplace"], flags: {} });`,
			home,
			source,
		);
		expect(offline.code).toBe(0);
		expect(offline.stdout).toContain("hello-plugin@2.0.0");
		expect(offline.stderr).toContain("Could not refresh marketplace: test-marketplace");
		expect(offline.stderr).toContain("last-known catalog data");
	}, 60_000);

	it.each(["cli", "slash"] as const)(
		"CLI and slash direct installs fetch a newly published version (%s)",
		async command => {
			const { home, source } = makeEnvironment();
			expect((await runScript(ADD_MARKETPLACE, home, source)).code).toBe(0);
			setSourceVersion(source, "2.0.0");
			const code =
				command === "cli"
					? `import { runPluginCommand } from "./src/cli/plugin-cli";
				   await runPluginCommand({ action: "install", args: ["hello-plugin@test-marketplace"], flags: {} });`
					: `import { registerLocales } from "@f5-sales-demo/pi-utils";
					   import { locales } from "./src/locales/index";
					   import { executeBuiltinSlashCommand } from "./src/slash-commands/builtin-registry";
					   registerLocales(locales);
					   const statuses = [];
					   const ctx = {
					     editor: { setText() {} },
					     sessionManager: { getCwd: () => process.cwd() },
					     showStatus: value => statuses.push(value),
					     showError: value => { throw new Error(value); },
					     showHookCustom(factory) {
					       return new Promise((resolve, reject) => {
					         const component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
					         void (async () => {
					           const registry = Bun.file(process.env.HOME + "/.xcsh/plugins/installed_plugins.json");
					           if (await registry.exists()) {
					             const state = await registry.json();
					             if (Object.keys(state.plugins ?? {}).length) throw new Error("Installed before review");
					           }
					           component.handleInput("\\x1b[B");
					           component.handleInput("\\r");
					         })().catch(reject);
					       });
					     },
					   };
					   await executeBuiltinSlashCommand("/plugin install hello-plugin@test-marketplace", { ctx, handleBackgroundCommand() {} });
					   console.log(JSON.stringify(statuses));`;
			const result = await runScript(code, home, source);
			if (result.code !== 0) throw new Error(result.stderr || result.stdout);
			const registry = JSON.parse(
				fs.readFileSync(path.join(home, ".xcsh", "plugins", "installed_plugins.json"), "utf8"),
			) as { plugins: Record<string, Array<{ version: string }>> };
			expect(registry.plugins["hello-plugin@test-marketplace"]?.[0]?.version).toBe("2.0.0");
		},
	);

	it.each(["slash-discover", "install-selector"] as const)(
		"slash discovery and the install selector refresh a fresh marketplace snapshot (%s)",
		async surface => {
			const { home, source } = makeEnvironment();
			expect((await runScript(ADD_MARKETPLACE, home, source)).code).toBe(0);
			setSourceVersion(source, "2.0.0");
			const code =
				surface === "slash-discover"
					? `import { registerLocales } from "@f5-sales-demo/pi-utils";
				   import { locales } from "./src/locales/index";
				   import { executeBuiltinSlashCommand } from "./src/slash-commands/builtin-registry";
				   registerLocales(locales);
				   const statuses = [];
				   const ctx = { editor: { setText() {} }, sessionManager: { getCwd: () => process.cwd() }, showStatus: value => statuses.push(value) };
				   await executeBuiltinSlashCommand("/plugin discover test-marketplace", { ctx, handleBackgroundCommand() {} });
				   if (!statuses.some(value => value.includes("hello-plugin@2.0.0"))) throw new Error(JSON.stringify(statuses));`
					: `import { PluginDashboard } from "./src/modes/components/plugins/plugin-dashboard";
				   const dashboard = await PluginDashboard.create(process.cwd(), 24, "discover");
				   const render = () => Bun.stripANSI(dashboard.render(80).join("\\n"));
				   for (let i = 0; i < 300 && !render().includes("Plugin information is up to date."); i++) await Bun.sleep(10);
				   if (!render().includes("Plugin information is up to date.")) throw new Error(render());
				   const cached = JSON.parse(await Bun.file(process.env.HOME + "/.xcsh/plugins/cache/marketplaces/test-marketplace/marketplace.json").text());
				   if (cached.plugins[0].version !== "2.0.0") throw new Error("plugin dashboard did not refresh");`;
			const result = await runScript(code, home, source);
			if (result.code !== 0) throw new Error(result.stderr || result.stdout);
		},
	);

	it("installed-only CLI operations stay offline", async () => {
		const { home, source } = makeEnvironment();
		expect((await runScript(ADD_MARKETPLACE, home, source)).code).toBe(0);
		const install = await runScript(
			`import { runPluginCommand } from "./src/cli/plugin-cli";
			 await runPluginCommand({ action: "install", args: ["hello-plugin@test-marketplace"], flags: {} });`,
			home,
			source,
		);
		if (install.code !== 0) throw new Error(install.stderr || install.stdout);
		fs.rmSync(source, { recursive: true, force: true });

		const offline = await runScript(
			`import { runPluginCommand } from "./src/cli/plugin-cli";
			 await runPluginCommand({ action: "list", args: [], flags: { json: true } });
			 await runPluginCommand({ action: "disable", args: ["hello-plugin@test-marketplace"], flags: { json: true } });
			 await runPluginCommand({ action: "enable", args: ["hello-plugin@test-marketplace"], flags: { json: true } });
			 await runPluginCommand({ action: "uninstall", args: ["hello-plugin@test-marketplace"], flags: { json: true } });`,
			home,
			source,
		);
		if (offline.code !== 0) throw new Error(offline.stderr || offline.stdout);
		expect(offline.stderr).not.toContain("refresh");
		expect(offline.stdout).toContain('"disabled":"hello-plugin@test-marketplace"');
	}, 60_000);

	it("argument-free plugin commands route through the dashboard at the intended tab", async () => {
		const { home, source } = makeEnvironment();
		const result = await runScript(
			`import { registerLocales } from "@f5-sales-demo/pi-utils";
			 import { locales } from "./src/locales/index";
			 import { executeBuiltinSlashCommand } from "./src/slash-commands/builtin-registry";
			 registerLocales(locales);
				 const opens = [];
				 const ctx = { editor: { setText() {} }, showPluginDashboard(tab) { opens.push(tab ?? "installed"); } };
				 await executeBuiltinSlashCommand("/plugin", { ctx, handleBackgroundCommand() {} });
				 await executeBuiltinSlashCommand("/plugin list", { ctx, handleBackgroundCommand() {} });
				 await executeBuiltinSlashCommand("/plugin install", { ctx, handleBackgroundCommand() {} });
				 await executeBuiltinSlashCommand("/plugin uninstall", { ctx, handleBackgroundCommand() {} });
				 if (JSON.stringify(opens) !== JSON.stringify(["installed", "installed", "discover", "installed"]))
				   throw new Error("dashboard routes were not used: " + JSON.stringify(opens));`,
			home,
			source,
		);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	}, 60_000);

	it("dashboard opening and Ctrl+R fetch remote data despite a fresh updatedAt", async () => {
		const { home, source } = makeEnvironment();
		expect((await runScript(ADD_MARKETPLACE, home, source)).code).toBe(0);
		setSourceVersion(source, "2.0.0");

		const result = await runScript(
			`import { PluginDashboard } from "./src/modes/components/plugins/plugin-dashboard";
			 const dashboard = await PluginDashboard.create(process.cwd(), 30);
			 const catalogPath = process.env.HOME + "/.xcsh/plugins/cache/marketplaces/test-marketplace/marketplace.json";
			 if (!Bun.stripANSI(dashboard.render(100).join("\\n")).includes("Loading plugin information"))
			   throw new Error("dashboard did not render its loading state immediately");
			 let catalog;
			 for (let i = 0; i < 100; i++) {
			   await Bun.sleep(10);
			   catalog = JSON.parse(await Bun.file(catalogPath).text());
			   if (catalog.plugins[0].version === "2.0.0") break;
			 }
			 if (catalog.plugins[0].version !== "2.0.0") throw new Error("dashboard open did not refresh");
			 const sourcePath = process.env.TEST_MARKETPLACE_SOURCE + "/.xcsh-plugin/marketplace.json";
			 catalog = JSON.parse(await Bun.file(sourcePath).text());
			 catalog.plugins[0].version = "3.0.0";
			 await Bun.write(sourcePath, JSON.stringify(catalog, null, 2) + "\\n");
			 dashboard.handleInput("\\x12");
			 for (let i = 0; i < 100; i++) {
			   await Bun.sleep(10);
			   const refreshed = JSON.parse(await Bun.file(catalogPath).text());
			   if (refreshed.plugins[0].version === "3.0.0") process.exit(0);
			 }
			 throw new Error("Ctrl+R did not refresh");`,
			home,
			source,
		);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	}, 60_000);
});
