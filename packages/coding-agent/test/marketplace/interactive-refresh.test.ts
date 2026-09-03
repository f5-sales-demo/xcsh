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
): Promise<{ stdout: string; stderr: string; code: number }> {
	const script = `await (await import("./src/modes/theme/theme")).setTheme("xcsh-dark");\n${code}`;
	const proc = Bun.spawn([process.execPath, "-e", script], {
		cwd: PACKAGE_ROOT,
		env: { ...process.env, HOME: home, TEST_MARKETPLACE_SOURCE: source },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code: exitCode };
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
	});

	it("CLI and slash direct installs fetch a newly published version", async () => {
		for (const command of ["cli", "slash"] as const) {
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
					   const ctx = { editor: { setText() {} }, sessionManager: { getCwd: () => process.cwd() }, showStatus: value => statuses.push(value) };
					   await executeBuiltinSlashCommand("/plugin install hello-plugin@test-marketplace", { ctx, handleBackgroundCommand() {} });
					   console.log(JSON.stringify(statuses));`;
			const result = await runScript(code, home, source);
			if (result.code !== 0) throw new Error(result.stderr || result.stdout);
			const registry = JSON.parse(
				fs.readFileSync(path.join(home, ".xcsh", "plugins", "installed_plugins.json"), "utf8"),
			) as { plugins: Record<string, Array<{ version: string }>> };
			expect(registry.plugins["hello-plugin@test-marketplace"]?.[0]?.version).toBe("2.0.0");
		}
	});

	it("slash discovery and the install selector refresh a fresh marketplace snapshot", async () => {
		for (const surface of ["slash-discover", "install-selector"] as const) {
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
					: `import { SelectorController } from "./src/modes/controllers/selector-controller";
					   const sink = { clear() {}, addChild() {} };
					   const ctx = { editorContainer: sink, editor: {}, ui: { setFocus() {}, requestRender() {} }, showStatus() {} };
					   await new SelectorController(ctx).showPluginSelector("install");
					   const cached = JSON.parse(await Bun.file(process.env.HOME + "/.xcsh/plugins/cache/marketplaces/test-marketplace/marketplace.json").text());
					   if (cached.plugins[0].version !== "2.0.0") throw new Error("install selector did not refresh");`;
			const result = await runScript(code, home, source);
			if (result.code !== 0) throw new Error(result.stderr || result.stdout);
		}
	});

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
	});

	it("/plugin and /plugin list route through the refreshing dashboard", async () => {
		const { home, source } = makeEnvironment();
		const result = await runScript(
			`import { registerLocales } from "@f5-sales-demo/pi-utils";
			 import { locales } from "./src/locales/index";
			 import { executeBuiltinSlashCommand } from "./src/slash-commands/builtin-registry";
			 registerLocales(locales);
			 let opens = 0;
			 const ctx = { editor: { setText() {} }, showPluginDashboard() { opens++; } };
			 await executeBuiltinSlashCommand("/plugin", { ctx, handleBackgroundCommand() {} });
			 await executeBuiltinSlashCommand("/plugin list", { ctx, handleBackgroundCommand() {} });
			 if (opens !== 2) throw new Error("dashboard routes were not used");`,
			home,
			source,
		);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	});

	it("dashboard opening and Ctrl+R fetch remote data despite a fresh updatedAt", async () => {
		const { home, source } = makeEnvironment();
		expect((await runScript(ADD_MARKETPLACE, home, source)).code).toBe(0);
		setSourceVersion(source, "2.0.0");

		const result = await runScript(
			`import { PluginDashboard } from "./src/modes/components/plugins/plugin-dashboard";
			 const dashboard = await PluginDashboard.create(process.cwd(), 30);
			 const catalogPath = process.env.HOME + "/.xcsh/plugins/cache/marketplaces/test-marketplace/marketplace.json";
			 let catalog = JSON.parse(await Bun.file(catalogPath).text());
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
	});
});
