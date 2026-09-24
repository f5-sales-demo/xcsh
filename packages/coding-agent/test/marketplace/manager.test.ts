import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	BUILTIN_MARKETPLACE_NAME,
	BUILTIN_MARKETPLACE_PROVENANCE,
	BUILTIN_MARKETPLACE_SOURCE,
	getBuiltinMarketplaceSnapshot,
	MarketplaceManager,
	readInstalledPluginsRegistry,
} from "../../src/extensibility/plugins/marketplace";
import { executeInstallAuthorizedSetup } from "../../src/integrations/setup";

// Fixture: the valid-marketplace directory used across all tests.
const FIXTURE_DIR = path.join(import.meta.dir, "fixtures", "valid-marketplace");

// ── Test helper ───────────────────────────────────────────────────────────────

interface TestContext {
	manager: MarketplaceManager;
	tmpDir: string;
	/** Incremented each time clearPluginRootsCache is called. */
	clearCount: () => number;
}

function createTestContext(): TestContext {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-test-"));

	const dirs = {
		mktRegistry: path.join(tmpDir, "marketplaces.json"),
		instRegistry: path.join(tmpDir, "installed_plugins.json"),
		projectInstRegistry: path.join(tmpDir, "project_installed_plugins.json"),
		mktCache: path.join(tmpDir, "cache", "marketplaces"),
		plugCache: path.join(tmpDir, "cache", "plugins"),
	};

	let count = 0;

	const manager = new MarketplaceManager({
		marketplacesRegistryPath: dirs.mktRegistry,
		installedRegistryPath: dirs.instRegistry,
		projectInstalledRegistryPath: dirs.projectInstRegistry,
		marketplacesCacheDir: dirs.mktCache,
		pluginsCacheDir: dirs.plugCache,
		clearPluginRootsCache: () => {
			count++;
		},
		includeBuiltinMarketplace: false,
	});

	return { manager, tmpDir, clearCount: () => count };
}

function writeDependencyMarketplace(
	root: string,
	name: string,
	plugins: ReadonlyArray<{ name: string; dependencies?: readonly string[]; source?: string; version?: string }>,
): string {
	const fixture = path.join(root, name);
	fs.mkdirSync(path.join(fixture, ".xcsh-plugin"), { recursive: true });
	for (const plugin of plugins) {
		const source = plugin.source ?? `./plugins/${plugin.name}`;
		if (!source.startsWith("./plugins/missing")) {
			fs.mkdirSync(path.resolve(fixture, source), { recursive: true });
			fs.writeFileSync(path.resolve(fixture, source, "README.md"), plugin.name);
		}
	}
	fs.writeFileSync(
		path.join(fixture, ".xcsh-plugin", "marketplace.json"),
		JSON.stringify({
			name,
			owner: { name: "Test" },
			plugins: plugins.map(plugin => ({
				name: plugin.name,
				source: plugin.source ?? `./plugins/${plugin.name}`,
				version: plugin.version ?? "1.0.0",
				lifecycle: {
					mode: "content",
					integrations: [],
					requirements: [],
					setupRequired: false,
					collectedData: [],
					pluginDependencies: plugin.dependencies ?? [],
				},
			})),
		}),
	);
	return fixture;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MarketplaceManager", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
	});

	it("reconciles an integrity-checked built-in marketplace and discovers its snapshot offline", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-builtin-marketplace-"));
		const manager = new MarketplaceManager({
			marketplacesRegistryPath: path.join(root, "marketplaces.json"),
			installedRegistryPath: path.join(root, "plugins", "installed_plugins.json"),
			marketplacesCacheDir: path.join(root, "plugins", "cache", "marketplaces"),
			pluginsCacheDir: path.join(root, "plugins", "cache", "plugins"),
		});
		try {
			const first = await manager.listMarketplaces();
			expect(first).toHaveLength(1);
			expect(first[0]).toMatchObject({
				name: BUILTIN_MARKETPLACE_NAME,
				sourceUri: BUILTIN_MARKETPLACE_SOURCE,
				enabled: true,
				builtIn: true,
			});
			expect(await manager.listMarketplaces()).toEqual(first);
			expect((await manager.listAvailablePlugins()).some(plugin => plugin.recommended)).toBe(true);
			expect(fs.existsSync(first[0].catalogPath)).toBe(true);
			const embeddedCatalog = getBuiltinMarketplaceSnapshot().catalog;
			expect(embeddedCatalog.name).toBe(BUILTIN_MARKETPLACE_NAME);
			expect(BUILTIN_MARKETPLACE_PROVENANCE.commit).toBe("6e31f9524c178669b73ba6e38a2316cd860924b4");
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "kvm")).toMatchObject({
				version: "3.0.0",
				lifecycle: { pluginDependencies: ["platform"] },
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "platform")).toMatchObject({
				version: "6.0.1",
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "github")).toMatchObject({
				version: "3.1.1",
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "cloudstatus")).toMatchObject({
				version: "1.7.0",
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "xorg")).toMatchObject({
				version: "1.1.2",
				lifecycle: { pluginDependencies: [] },
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "kvm")).toMatchObject({
				version: "3.0.0",
				lifecycle: { pluginDependencies: ["platform"] },
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "zoom")).toMatchObject({
				version: "1.0.5",
				lifecycle: { pluginDependencies: ["xorg"] },
			});
			expect(embeddedCatalog.plugins.find(plugin => plugin.name === "herdr")).toMatchObject({
				version: "1.1.2",
				lifecycle: {
					integrations: ["herdr"],
					setupRequired: true,
				},
			});
			expect(BUILTIN_MARKETPLACE_PROVENANCE.sha256).toBe(
				"3790d1958066a68a6aff310b2e79f37f40a2b40f00746f210d762e0085177e97",
			);
			expect(JSON.parse(fs.readFileSync(path.join(root, "marketplaces.json"), "utf8")).version).toBe(2);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("reconciles the reserved built-in name and source while preserving custom entries", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-builtin-reconcile-"));
		const registryPath = path.join(root, "marketplaces.json");
		fs.writeFileSync(
			registryPath,
			JSON.stringify({
				version: 1,
				marketplaces: [
					{
						name: BUILTIN_MARKETPLACE_NAME,
						sourceType: "local",
						sourceUri: "/wrong",
						catalogPath: "/wrong/catalog.json",
						addedAt: "2025-01-01T00:00:00.000Z",
						updatedAt: "2025-01-01T00:00:00.000Z",
					},
					{
						name: "custom",
						sourceType: "local",
						sourceUri: "/custom",
						catalogPath: "/custom/marketplace.json",
						addedAt: "2025-01-01T00:00:00.000Z",
						updatedAt: "2025-01-01T00:00:00.000Z",
					},
				],
			}),
		);
		const manager = new MarketplaceManager({
			marketplacesRegistryPath: registryPath,
			installedRegistryPath: path.join(root, "plugins", "installed_plugins.json"),
			marketplacesCacheDir: path.join(root, "plugins", "cache", "marketplaces"),
			pluginsCacheDir: path.join(root, "plugins", "cache", "plugins"),
		});
		try {
			const marketplaces = await manager.listMarketplaces();
			expect(marketplaces.map(entry => entry.name)).toEqual([BUILTIN_MARKETPLACE_NAME, "custom"]);
			expect(marketplaces[0]).toMatchObject({
				sourceType: "github",
				sourceUri: BUILTIN_MARKETPLACE_SOURCE,
				builtIn: true,
			});
			await expect(manager.removeMarketplace(BUILTIN_MARKETPLACE_NAME)).rejects.toThrow(/Disable it instead/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	// ── Marketplace lifecycle ──────────────────────────────────────────────

	it("addMarketplace with local fixture → appears in listMarketplaces", async () => {
		const entry = await ctx.manager.addMarketplace(FIXTURE_DIR);

		expect(entry.name).toBe("test-marketplace");
		expect(entry.sourceType).toBe("local");
		expect(entry.sourceUri).toBe(FIXTURE_DIR);

		const list = await ctx.manager.listMarketplaces();
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe("test-marketplace");
	});

	it("addMarketplace with duplicate name → throws", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await expect(ctx.manager.addMarketplace(FIXTURE_DIR)).rejects.toThrow(/already exists/);
	});

	it("removeMarketplace → gone from list and catalog cache removed", async () => {
		const entry = await ctx.manager.addMarketplace(FIXTURE_DIR);

		// Catalog file should exist in cache
		expect(fs.existsSync(entry.catalogPath)).toBe(true);

		await ctx.manager.removeMarketplace("test-marketplace");

		const list = await ctx.manager.listMarketplaces();
		expect(list).toHaveLength(0);

		// Catalog cache dir should be gone
		const catalogDir = path.dirname(entry.catalogPath);
		expect(fs.existsSync(catalogDir)).toBe(false);
	});

	it("updateMarketplace on nonexistent marketplace → throws", async () => {
		await expect(ctx.manager.updateMarketplace("ghost")).rejects.toThrow(/not found/);
	});

	it("updateMarketplace re-fetches and updates updatedAt", async () => {
		const added = await ctx.manager.addMarketplace(FIXTURE_DIR);

		// Small sleep so clock advances
		await Bun.sleep(5);

		const updated = await ctx.manager.updateMarketplace("test-marketplace");
		expect(updated.name).toBe("test-marketplace");
		expect(updated.addedAt).toBe(added.addedAt);
		// updatedAt must be at or after addedAt
		expect(new Date(updated.updatedAt) >= new Date(added.addedAt)).toBe(true);
	});

	// ── Plugin discovery ───────────────────────────────────────────────────

	it("listAvailablePlugins → returns catalog entries", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const plugins = await ctx.manager.listAvailablePlugins();
		expect(plugins).toHaveLength(1);
		expect(plugins[0].name).toBe("hello-plugin");
	});

	it("listAvailablePlugins(marketplace) → filtered to that marketplace", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const plugins = await ctx.manager.listAvailablePlugins("test-marketplace");
		expect(plugins).toHaveLength(1);
		expect(plugins[0].name).toBe("hello-plugin");
	});

	it("listAvailablePlugins(unknown) → throws", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await expect(ctx.manager.listAvailablePlugins("no-such")).rejects.toThrow(/not found/);
	});

	// ── Install ────────────────────────────────────────────────────────────

	it("installPlugin → plugin in cache + in registry", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		expect(instEntry.scope).toBe("user");
		expect(instEntry.version).toBe("1.0.0");
		expect(fs.existsSync(instEntry.installPath)).toBe(true);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed).toHaveLength(1);
		expect(installed[0].id).toBe("hello-plugin@test-marketplace");
	});

	it("installPlugin with scope:project → stores project scope", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});
		expect(instEntry.scope).toBe("project");
		expect(instEntry.version).toBe("1.0.0");
		expect(fs.existsSync(instEntry.installPath)).toBe(true);

		// Verify scope was persisted to the registry, not just returned in-memory.
		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed[0].entries[0].scope).toBe("project");
	});

	it("installPlugin already installed → throws without force", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		await expect(ctx.manager.installPlugin("hello-plugin", "test-marketplace")).rejects.toThrow(/already installed/);
	});

	it("installPlugin with force:true → replaces existing", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const first = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		const second = await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			force: true,
		});

		expect(second.installPath).toBe(first.installPath);
		expect(fs.existsSync(second.installPath)).toBe(true);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed).toHaveLength(1);
	});

	it("local force reinstall publishes a new immutable snapshot and preserves the running snapshot", async () => {
		const fixture = writeDependencyMarketplace(ctx.tmpDir, "live-marketplace", [{ name: "hello-plugin" }]);
		await ctx.manager.addMarketplace(fixture);
		const first = await ctx.manager.installPlugin("hello-plugin", "live-marketplace");
		fs.writeFileSync(path.join(fixture, "plugins", "hello-plugin", "README.md"), "changed");

		const second = await ctx.manager.installPlugin("hello-plugin", "live-marketplace", { force: true });

		expect(second.installPath).not.toBe(first.installPath);
		expect(fs.readFileSync(path.join(first.installPath, "README.md"), "utf8")).toBe("hello-plugin");
		expect(fs.readFileSync(path.join(second.installPath, "README.md"), "utf8")).toBe("changed");
	});

	it("keeps a local snapshot alive through refresh, setup, and post-setup verification", async () => {
		const fixture = writeDependencyMarketplace(ctx.tmpDir, "live-marketplace", [{ name: "kvm" }]);
		const sourceReadme = path.join(fixture, "plugins", "kvm", "README.md");
		await ctx.manager.addMarketplace(fixture);
		const active = await ctx.manager.installPlugin("kvm", "live-marketplace");
		const activeReadme = path.join(active.installPath, "README.md");
		const plan = {
			pluginDependencies: [],
			requiredEnvironment: [],
			profileFields: [],
			steps: [{ kind: "install" as const, argv: ["controller", "setup"], timeoutMs: 1_000 }],
			verification: [],
		};
		const activeHandle = {
			id: "kvm",
			name: "KVM",
			plugin: "kvm@live-marketplace",
			setupPlan: plan,
			get: async () => ({
				id: "kvm",
				name: "KVM",
				plugin: "kvm@live-marketplace",
				state: "setup_required" as const,
				checkedAt: 1,
				durationMs: 0,
			}),
			invalidate() {},
			verifyAfterSetup: async () =>
				fs.existsSync(activeReadme)
					? {
							id: "kvm",
							name: "KVM",
							plugin: "kvm@live-marketplace",
							state: "ready" as const,
							value: fs.readFileSync(activeReadme, "utf8"),
							checkedAt: 2,
							durationMs: 0,
						}
					: {
							id: "kvm",
							name: "KVM",
							plugin: "kvm@live-marketplace",
							state: "setup_required" as const,
							reason: "dependency_missing" as const,
							checkedAt: 2,
							durationMs: 0,
						},
		};

		fs.writeFileSync(sourceReadme, "refreshed");
		const refreshed = await ctx.manager.installPlugin("kvm", "live-marketplace", { force: true });
		expect(refreshed.installPath).not.toBe(active.installPath);

		const result = await executeInstallAuthorizedSetup({
			plugin: "kvm",
			lifecycle: { setupRequired: true, setupAuthorization: "install" },
			trigger: "direct-install",
			handles: [activeHandle],
			run: async () => 0,
		});

		expect(result).toMatchObject({ state: "ready", value: "kvm" });
		expect(fs.readFileSync(activeReadme, "utf8")).toBe("kvm");
		expect(fs.readFileSync(path.join(refreshed.installPath, "README.md"), "utf8")).toBe("refreshed");
	});

	it("installPlugin with nonexistent marketplace → clear error", async () => {
		await expect(ctx.manager.installPlugin("hello-plugin", "no-such-market")).rejects.toThrow(
			/Marketplace "no-such-market" not found/,
		);
	});

	it("installPlugin with nonexistent plugin in catalog → clear error", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await expect(ctx.manager.installPlugin("ghost-plugin", "test-marketplace")).rejects.toThrow(
			/Plugin "ghost-plugin" not found in marketplace "test-marketplace"/,
		);
	});

	it("installPlugin calls clearPluginRootsCache", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const before = ctx.clearCount();
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		expect(ctx.clearCount()).toBe(before + 1);
	});

	it("installs a dependency before its dependent and protects the dependency from uninstall", async () => {
		const fixture = path.join(ctx.tmpDir, "dependency-marketplace");
		fs.mkdirSync(path.join(fixture, ".xcsh-plugin"), { recursive: true });
		for (const name of ["xorg", "zoom"]) {
			fs.mkdirSync(path.join(fixture, "plugins", name), { recursive: true });
			fs.writeFileSync(path.join(fixture, "plugins", name, "README.md"), name);
		}
		fs.writeFileSync(
			path.join(fixture, ".xcsh-plugin", "marketplace.json"),
			JSON.stringify({
				name: "dependency-marketplace",
				owner: { name: "Test" },
				plugins: [
					{
						name: "xorg",
						source: "./plugins/xorg",
						version: "1.0.0",
						lifecycle: {
							mode: "content",
							integrations: [],
							requirements: [],
							setupRequired: false,
							collectedData: [],
							pluginDependencies: [],
						},
					},
					{
						name: "zoom",
						source: "./plugins/zoom",
						version: "1.0.0",
						lifecycle: {
							mode: "content",
							integrations: [],
							requirements: [],
							setupRequired: false,
							collectedData: [],
							pluginDependencies: ["xorg"],
						},
					},
				],
			}),
		);
		await ctx.manager.addMarketplace(fixture);
		await ctx.manager.installPlugin("zoom", "dependency-marketplace");
		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed.map(entry => entry.id)).toEqual(["xorg@dependency-marketplace", "zoom@dependency-marketplace"]);
		await expect(ctx.manager.setPluginEnabled("xorg@dependency-marketplace", false)).rejects.toThrow(
			/required by installed plugin/,
		);
		await expect(ctx.manager.uninstallPlugin("xorg@dependency-marketplace")).rejects.toThrow(
			/required by installed plugin/,
		);
	});

	it("rolls back newly installed dependencies when a dependent cannot be staged", async () => {
		const fixture = path.join(ctx.tmpDir, "rollback-marketplace");
		fs.mkdirSync(path.join(fixture, ".xcsh-plugin"), { recursive: true });
		fs.mkdirSync(path.join(fixture, "plugins", "xorg"), { recursive: true });
		fs.writeFileSync(path.join(fixture, "plugins", "xorg", "README.md"), "xorg");
		fs.writeFileSync(
			path.join(fixture, ".xcsh-plugin", "marketplace.json"),
			JSON.stringify({
				name: "rollback-marketplace",
				owner: { name: "Test" },
				plugins: [
					{
						name: "xorg",
						source: "./plugins/xorg",
						version: "1.0.0",
						lifecycle: {
							mode: "content",
							integrations: [],
							requirements: [],
							setupRequired: false,
							collectedData: [],
							pluginDependencies: [],
						},
					},
					{
						name: "zoom",
						source: "./plugins/missing",
						version: "1.0.0",
						lifecycle: {
							mode: "content",
							integrations: [],
							requirements: [],
							setupRequired: false,
							collectedData: [],
							pluginDependencies: ["xorg"],
						},
					},
				],
			}),
		);
		await ctx.manager.addMarketplace(fixture);
		await expect(ctx.manager.installPlugin("zoom", "rollback-marketplace")).rejects.toThrow();
		expect(await ctx.manager.listInstalledPlugins()).toEqual([]);
		expect(fs.readdirSync(path.join(ctx.tmpDir, "cache", "plugins"))).toEqual([]);
	});

	it.each([
		["missing", [{ name: "zoom", dependencies: ["xorg"] }], /dependency "xorg" is missing/],
		["self", [{ name: "zoom", dependencies: ["zoom"] }], /cannot depend on itself/],
		[
			"cycle",
			[
				{ name: "zoom", dependencies: ["xorg"] },
				{ name: "xorg", dependencies: ["zoom"] },
			],
			/dependency cycle: zoom -> xorg -> zoom/,
		],
	] as const)("rejects a %s dependency graph before mutation", async (name, plugins, error) => {
		const fixture = writeDependencyMarketplace(ctx.tmpDir, `${name}-marketplace`, [...plugins]);
		await ctx.manager.addMarketplace(fixture);

		await expect(ctx.manager.installPlugin("zoom", `${name}-marketplace`)).rejects.toThrow(error);
		expect(await ctx.manager.listInstalledPlugins()).toEqual([]);
		expect(fs.existsSync(path.join(ctx.tmpDir, "cache", "plugins"))).toBe(false);
	});

	it("installs transitive dependencies in topological order and re-enables required plugins", async () => {
		const fixture = writeDependencyMarketplace(ctx.tmpDir, "ordered-marketplace", [
			{ name: "base" },
			{ name: "xorg", dependencies: ["base"] },
			{ name: "zoom", dependencies: ["xorg"] },
		]);
		await ctx.manager.addMarketplace(fixture);
		await ctx.manager.installPlugin("xorg", "ordered-marketplace");
		await ctx.manager.setPluginEnabled("xorg@ordered-marketplace", false);

		await ctx.manager.installPlugin("zoom", "ordered-marketplace");
		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed.map(entry => entry.id)).toEqual([
			"base@ordered-marketplace",
			"xorg@ordered-marketplace",
			"zoom@ordered-marketplace",
		]);
		expect(installed.find(entry => entry.id === "xorg@ordered-marketplace")?.effectiveEnabled).toBe(true);
	});

	it("describes the complete dependency plan and installs every node at project scope", async () => {
		const fixture = writeDependencyMarketplace(ctx.tmpDir, "project-plan-marketplace", [
			{ name: "base", version: "1.0.0" },
			{ name: "xorg", version: "1.1.0", dependencies: ["base"] },
			{ name: "zoom", version: "1.2.0", dependencies: ["xorg"] },
		]);
		await ctx.manager.addMarketplace(fixture);

		expect(await ctx.manager.getPluginDependencyPlan("zoom", "project-plan-marketplace", "project")).toEqual([
			{
				pluginId: "base@project-plan-marketplace",
				version: "1.0.0",
				scope: "project",
				dependency: true,
			},
			{
				pluginId: "xorg@project-plan-marketplace",
				version: "1.1.0",
				scope: "project",
				dependency: true,
			},
			{
				pluginId: "zoom@project-plan-marketplace",
				version: "1.2.0",
				scope: "project",
				dependency: false,
			},
		]);

		await ctx.manager.installPlugin("zoom", "project-plan-marketplace", { scope: "project" });
		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed.map(entry => [entry.id, entry.scope])).toEqual([
			["base@project-plan-marketplace", "project"],
			["xorg@project-plan-marketplace", "project"],
			["zoom@project-plan-marketplace", "project"],
		]);
		expect(await readInstalledPluginsRegistry(path.join(ctx.tmpDir, "installed_plugins.json"))).toEqual({
			version: 2,
			plugins: {},
		});
	});

	it.each(["user", "project"] as const)(
		"restores an existing dependency and removes its staged cache when the dependent fails in %s scope",
		async scope => {
			const fixture = writeDependencyMarketplace(ctx.tmpDir, "upgrade-rollback-marketplace", [{ name: "xorg" }]);
			const marketplace = await ctx.manager.addMarketplace(fixture);
			const original = await ctx.manager.installPlugin("xorg", "upgrade-rollback-marketplace", { scope });
			const catalog = JSON.parse(fs.readFileSync(marketplace.catalogPath, "utf8")) as {
				plugins: Array<Record<string, unknown>>;
			};
			catalog.plugins[0] = { ...catalog.plugins[0], version: "2.0.0" };
			catalog.plugins.push({
				name: "zoom",
				source: "./plugins/missing",
				version: "1.0.0",
				lifecycle: {
					mode: "content",
					integrations: [],
					requirements: [],
					setupRequired: false,
					collectedData: [],
					pluginDependencies: ["xorg"],
				},
			});
			fs.writeFileSync(marketplace.catalogPath, JSON.stringify(catalog));

			await expect(ctx.manager.installPlugin("zoom", "upgrade-rollback-marketplace", { scope })).rejects.toThrow();
			const installed = await ctx.manager.listInstalledPlugins();
			expect(installed).toHaveLength(1);
			expect(installed[0]).toMatchObject({
				scope,
				entries: [{ version: "1.0.0", installPath: original.installPath }],
			});
			expect(fs.existsSync(original.installPath)).toBe(true);
			expect(
				fs.existsSync(path.join(ctx.tmpDir, "cache", "plugins", "upgrade-rollback-marketplace", "xorg", "2.0.0")),
			).toBe(false);
		},
	);

	// ── Uninstall ──────────────────────────────────────────────────────────

	it("uninstallPlugin → cache removed + deregistered", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace");

		expect(fs.existsSync(instEntry.installPath)).toBe(false);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed).toHaveLength(0);
	});

	it("uninstallPlugin nonexistent → throws", async () => {
		await expect(ctx.manager.uninstallPlugin("ghost-plugin@nowhere")).rejects.toThrow(/not installed/);
	});

	it("uninstallPlugin with invalid ID format → throws clear error", async () => {
		await expect(ctx.manager.uninstallPlugin("no-at-sign")).rejects.toThrow(/Invalid plugin ID format/);
	});

	it("uninstallPlugin calls clearPluginRootsCache", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		const before = ctx.clearCount();
		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace");
		expect(ctx.clearCount()).toBe(before + 1);
	});

	// ── setPluginEnabled ───────────────────────────────────────────────────

	it("setPluginEnabled → persisted in registry", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", false);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed[0].entries[0].enabled).toBe(false);

		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", true);
		const updated = await ctx.manager.listInstalledPlugins();
		expect(updated[0].entries[0].enabled).toBe(true);
	});

	it("setPluginEnabled on nonexistent plugin → throws", async () => {
		await expect(ctx.manager.setPluginEnabled("ghost@nowhere", true)).rejects.toThrow(/not installed/);
	});

	it("setPluginEnabled calls clearPluginRootsCache", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		const before = ctx.clearCount();
		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", false);
		expect(ctx.clearCount()).toBe(before + 1);
	});

	it("marketplace disable blocks lifecycle operations and requires explicit plugin re-enable", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		const disabled = await ctx.manager.setMarketplaceEnabled("test-marketplace", false);
		expect(disabled.pluginsDisabledAt).toBeDefined();
		expect(await ctx.manager.listAvailablePlugins("test-marketplace")).toEqual([]);
		expect(await ctx.manager.refreshMarketplaces(["test-marketplace"])).toEqual({ successful: [], failed: [] });
		await expect(ctx.manager.updateMarketplace("test-marketplace")).rejects.toThrow(/disabled/);
		await expect(
			ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
				force: true,
			}),
		).rejects.toThrow(/disabled/);
		expect(await ctx.manager.checkForUpdates()).toEqual([]);

		await ctx.manager.setMarketplaceEnabled("test-marketplace", true);
		expect((await ctx.manager.listInstalledPlugins())[0]?.effectiveEnabled).toBe(false);
		await Bun.sleep(2);
		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", true);
		expect((await ctx.manager.listInstalledPlugins())[0]?.effectiveEnabled).toBe(true);

		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace");
		await Bun.sleep(2);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		expect((await ctx.manager.listInstalledPlugins())[0]?.effectiveEnabled).toBe(true);
	});

	// ── version fallback ───────────────────────────────────────────────────

	it("installPlugin falls back to plugin.json version when catalog version is missing", async () => {
		// Write a catalog without a version field on the plugin
		await ctx.manager.addMarketplace(FIXTURE_DIR);

		// Mutate the cached catalog to remove version
		const list = await ctx.manager.listMarketplaces();
		const catalogPath = list[0].catalogPath;
		const content = await Bun.file(catalogPath).text();
		const catalog = JSON.parse(content) as {
			plugins: Array<Record<string, unknown>>;
		};
		catalog.plugins[0] = { ...catalog.plugins[0] };
		delete catalog.plugins[0].version;
		await Bun.write(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		// No catalog version, but fixture's .xcsh-plugin/plugin.json has version "1.0.0"
		expect(instEntry.version).toBe("1.0.0");
	});
	// ── Scope feature ────────────────────────────────────────────────────────

	it("installPlugin scope:project → writes to project registry, not user registry", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		const projectReg = await readInstalledPluginsRegistry(path.join(ctx.tmpDir, "project_installed_plugins.json"));
		expect(projectReg.plugins["hello-plugin@test-marketplace"]).toBeDefined();
		expect(projectReg.plugins["hello-plugin@test-marketplace"]![0].scope).toBe("project");

		// User registry must NOT contain this plugin.
		const userReg = await readInstalledPluginsRegistry(path.join(ctx.tmpDir, "installed_plugins.json"));
		expect(userReg.plugins["hello-plugin@test-marketplace"]).toBeUndefined();
	});

	it("installPlugin scope:project when no projectInstalledRegistryPath → throws", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-noproj-"));
		try {
			const noProjectManager = new MarketplaceManager({
				marketplacesRegistryPath: path.join(tmp, "marketplaces.json"),
				installedRegistryPath: path.join(tmp, "installed_plugins.json"),
				marketplacesCacheDir: path.join(tmp, "cache", "marketplaces"),
				pluginsCacheDir: path.join(tmp, "cache", "plugins"),
			});
			await noProjectManager.addMarketplace(FIXTURE_DIR);
			await expect(
				noProjectManager.installPlugin("hello-plugin", "test-marketplace", {
					scope: "project",
				}),
			).rejects.toThrow(/project directory/);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("uninstallPlugin with plugin in both scopes, no scope arg → throws disambiguation error", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "user",
		});
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		await expect(ctx.manager.uninstallPlugin("hello-plugin@test-marketplace")).rejects.toThrow(
			/both user and project scope/,
		);
	});

	it("uninstallPlugin scope:user removes only user entry, keeps project entry", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "user",
		});
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace", "user");

		const userReg = await readInstalledPluginsRegistry(path.join(ctx.tmpDir, "installed_plugins.json"));
		expect(userReg.plugins["hello-plugin@test-marketplace"]).toBeUndefined();

		const projectReg = await readInstalledPluginsRegistry(path.join(ctx.tmpDir, "project_installed_plugins.json"));
		expect(projectReg.plugins["hello-plugin@test-marketplace"]).toBeDefined();
		expect(projectReg.plugins["hello-plugin@test-marketplace"]![0].scope).toBe("project");
	});

	it("uninstallPlugin does not delete cache dir when other scope still references it", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const userEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "user",
		});
		// Same plugin+version → same cache path for the project-scope install.
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace", "user");

		// Cache must still exist — project scope still references it.
		expect(fs.existsSync(userEntry.installPath)).toBe(true);
	});

	it("setPluginEnabled with plugin in both scopes, no scope arg → throws disambiguation error", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "user",
		});
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		await expect(ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", false)).rejects.toThrow(
			/both user and project scope/,
		);
	});

	it("upgradePlugin with plugin in both scopes, no scope arg → throws disambiguation error", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "user",
		});
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		await expect(ctx.manager.upgradePlugin("hello-plugin@test-marketplace")).rejects.toThrow(
			/both user and project scope/,
		);
	});

	it("listInstalledPlugins marks user entry as shadowed when project entry exists for same ID", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "user",
		});
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			scope: "project",
		});

		const installed = await ctx.manager.listInstalledPlugins();
		const userSummary = installed.find(p => p.id === "hello-plugin@test-marketplace" && p.scope === "user");
		expect(userSummary).toBeDefined();
		expect(userSummary!.shadowedBy).toBe("project");
	});

	// ── auto-update ──────────────────────────────────────────────────────────

	describe("auto-update", () => {
		// Read catalogPath from the (single) registered marketplace.
		async function getCatalogPath(): Promise<string> {
			const list = await ctx.manager.listMarketplaces();
			return list[0].catalogPath;
		}

		// Overwrite the version field on the first plugin entry in the cached catalog.
		async function bumpCatalogVersion(newVersion: string): Promise<void> {
			const catalogPath = await getCatalogPath();
			const content = await Bun.file(catalogPath).text();
			const catalog = JSON.parse(content) as {
				plugins: Array<Record<string, unknown>>;
			};
			catalog.plugins[0] = { ...catalog.plugins[0], version: newVersion };
			await Bun.write(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
		}

		// Directly patch updatedAt in the marketplaces registry file.
		function setMarketplaceUpdatedAt(iso: string): void {
			const regPath = path.join(ctx.tmpDir, "marketplaces.json");
			const reg = JSON.parse(fs.readFileSync(regPath, "utf-8")) as {
				version: number;
				marketplaces: Array<{ updatedAt: string }>;
			};
			reg.marketplaces[0].updatedAt = iso;
			fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
		}

		it("upgradeAllPlugins({ refresh: true }) observes a freshly-published source version", async () => {
			// Writable copy of the fixture so a new version can be "published" to the SOURCE
			// (the cached catalog is what goes stale — bumpCatalogVersion patches the cache and
			// therefore never exercises the stale-cache path this bug is about).
			const sourceDir = path.join(ctx.tmpDir, "source-marketplace");
			fs.cpSync(FIXTURE_DIR, sourceDir, { recursive: true });

			await ctx.manager.addMarketplace(sourceDir); // caches catalog @ 1.0.0
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace"); // installed @ 1.0.0

			// Publish 1.2.0 to the SOURCE only; the on-disk cached catalog still says 1.0.0.
			const srcCatalog = path.join(sourceDir, ".xcsh-plugin", "marketplace.json");
			const cat = JSON.parse(fs.readFileSync(srcCatalog, "utf-8")) as {
				plugins: Array<Record<string, unknown>>;
			};
			cat.plugins[0] = { ...cat.plugins[0], version: "1.2.0" };
			fs.writeFileSync(srcCatalog, JSON.stringify(cat, null, 2));

			// Control: without a refresh the stale cache hides the new version.
			expect(await ctx.manager.upgradeAllPlugins()).toHaveLength(0);

			// Clean-break behavior: an explicit refresh re-fetches the catalog and upgrades.
			const results = await ctx.manager.upgradeAllPlugins({ refresh: true });
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				pluginId: "hello-plugin@test-marketplace",
				from: "1.0.0",
				to: "1.2.0",
			});
		});

		it("checkForUpdates returns outdated plugins", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
			await bumpCatalogVersion("2.0.0");

			const updates = await ctx.manager.checkForUpdates();

			expect(updates).toHaveLength(1);
			expect(updates[0]).toEqual({
				pluginId: "hello-plugin@test-marketplace",
				scope: "user",
				from: "1.0.0",
				to: "2.0.0",
			});
		});

		it("previewPluginUpdates fetches current catalogs without mutating plugin state", async () => {
			const sourceDir = path.join(ctx.tmpDir, "preview-source-marketplace");
			fs.cpSync(FIXTURE_DIR, sourceDir, { recursive: true });
			await ctx.manager.addMarketplace(sourceDir);
			const installedEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
			const marketplaceEntry = (await ctx.manager.listMarketplaces())[0];
			const marketplaceRegistryPath = path.join(ctx.tmpDir, "marketplaces.json");
			const installedRegistryPath = path.join(ctx.tmpDir, "installed_plugins.json");
			const before = {
				marketplaceRegistry: fs.readFileSync(marketplaceRegistryPath, "utf-8"),
				installedRegistry: fs.readFileSync(installedRegistryPath, "utf-8"),
				cachedCatalog: fs.readFileSync(marketplaceEntry.catalogPath, "utf-8"),
				installedManifest: fs.readFileSync(
					path.join(installedEntry.installPath, ".xcsh-plugin", "plugin.json"),
					"utf-8",
				),
				clearCount: ctx.clearCount(),
			};

			const sourceCatalogPath = path.join(sourceDir, ".xcsh-plugin", "marketplace.json");
			const sourceCatalog = JSON.parse(fs.readFileSync(sourceCatalogPath, "utf-8")) as {
				plugins: Array<Record<string, unknown>>;
			};
			sourceCatalog.plugins[0] = {
				...sourceCatalog.plugins[0],
				version: "2.0.0",
			};
			fs.writeFileSync(sourceCatalogPath, JSON.stringify(sourceCatalog, null, 2));

			expect(await ctx.manager.previewPluginUpdates()).toEqual([
				{
					pluginId: "hello-plugin@test-marketplace",
					scope: "user",
					from: "1.0.0",
					to: "2.0.0",
				},
			]);
			expect(fs.readFileSync(marketplaceRegistryPath, "utf-8")).toBe(before.marketplaceRegistry);
			expect(fs.readFileSync(installedRegistryPath, "utf-8")).toBe(before.installedRegistry);
			expect(fs.readFileSync(marketplaceEntry.catalogPath, "utf-8")).toBe(before.cachedCatalog);
			expect(fs.readFileSync(path.join(installedEntry.installPath, ".xcsh-plugin", "plugin.json"), "utf-8")).toBe(
				before.installedManifest,
			);
			expect(ctx.clearCount()).toBe(before.clearCount);
		});

		it("checkForUpdates returns empty when up to date", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
			// Catalog and installed version are both 1.0.0 — nothing to report.

			const updates = await ctx.manager.checkForUpdates();
			expect(updates).toEqual([]);
		});

		it("checkForUpdates skips plugins with no catalog version", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

			// Strip the version field from the cached catalog entry.
			const catalogPath = await getCatalogPath();
			const content = await Bun.file(catalogPath).text();
			const catalog = JSON.parse(content) as {
				plugins: Array<Record<string, unknown>>;
			};
			delete catalog.plugins[0].version;
			await Bun.write(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

			const updates = await ctx.manager.checkForUpdates();
			expect(updates).toEqual([]);
		});

		it("checkForUpdates handles missing catalog gracefully", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

			// Delete the cached catalog file; checkForUpdates must skip rather than throw.
			const catalogPath = await getCatalogPath();
			fs.unlinkSync(catalogPath);

			const updates = await ctx.manager.checkForUpdates();
			expect(updates).toEqual([]);
		});

		it("upgradePlugin updates the installed version", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
			await bumpCatalogVersion("2.0.0");

			const entry = await ctx.manager.upgradePlugin("hello-plugin@test-marketplace");
			expect(entry.version).toBe("2.0.0");

			// Confirm the registry reflects the new version.
			const installed = await ctx.manager.listInstalledPlugins();
			expect(installed).toHaveLength(1);
			expect(installed[0].entries[0].version).toBe("2.0.0");
		});

		it("upgradePlugin rejects invalid plugin ID", async () => {
			await expect(ctx.manager.upgradePlugin("no-at-sign")).rejects.toThrow(/Invalid plugin ID/);
		});

		it("upgradePlugin preserves the scope of the existing install", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
				scope: "project",
			});
			await bumpCatalogVersion("2.0.0");

			const entry = await ctx.manager.upgradePlugin("hello-plugin@test-marketplace");
			expect(entry.scope).toBe("project");
			expect(entry.version).toBe("2.0.0");
		});

		it("upgradeAllPlugins upgrades outdated plugins and returns results", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

			// Inject a second plugin that has no catalog entry — checkForUpdates will skip it,
			// proving upgradeAllPlugins only acts on genuinely outdated plugins.
			const instRegPath = path.join(ctx.tmpDir, "installed_plugins.json");
			const reg = JSON.parse(fs.readFileSync(instRegPath, "utf-8")) as {
				version: number;
				plugins: Record<string, unknown[]>;
			};
			const now = new Date().toISOString();
			reg.plugins["phantom-plugin@test-marketplace"] = [
				{
					scope: "user",
					installPath: "/nonexistent",
					version: "1.0.0",
					installedAt: now,
					lastUpdated: now,
				},
			];
			fs.writeFileSync(instRegPath, JSON.stringify(reg, null, 2));

			// Only hello-plugin gets a version bump in the catalog.
			await bumpCatalogVersion("2.0.0");

			const results = await ctx.manager.upgradeAllPlugins();

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				pluginId: "hello-plugin@test-marketplace",
				scope: "user",
				from: "1.0.0",
				to: "2.0.0",
			});
		});

		it("upgradeAllPlugins returns empty array when all plugins are up to date", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
			// No catalog modification — installed and catalog both at 1.0.0.

			const results = await ctx.manager.upgradeAllPlugins();
			expect(results).toEqual([]);
		});

		it("refreshStaleMarketplaces skips fresh marketplaces", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			// updatedAt is just now — not past the 24-hour threshold.
			await bumpCatalogVersion("2.0.0");

			await ctx.manager.refreshStaleMarketplaces();

			// Catalog should remain at 2.0.0 — the marketplace was not re-fetched.
			const catalogPath = await getCatalogPath();
			const content = await Bun.file(catalogPath).text();
			const catalog = JSON.parse(content) as {
				plugins: Array<{ version?: string }>;
			};
			expect(catalog.plugins[0].version).toBe("2.0.0");
		});

		it("refreshStaleMarketplaces re-fetches stale marketplaces", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			// Tamper with catalog to simulate drift from the real source.
			await bumpCatalogVersion("2.0.0");

			// Force updatedAt to 25 hours ago — past the 24-hour staleness threshold.
			const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			setMarketplaceUpdatedAt(staleDate);

			await ctx.manager.refreshStaleMarketplaces();

			// updateMarketplace re-fetches from FIXTURE_DIR which has version 1.0.0.
			const catalogPath = await getCatalogPath();
			const content = await Bun.file(catalogPath).text();
			const catalog = JSON.parse(content) as {
				plugins: Array<{ version?: string }>;
			};
			expect(catalog.plugins[0].version).toBe("1.0.0");
		});

		it("upgradePluginAcrossScopes upgrades in all scopes, returns both entries", async () => {
			await ctx.manager.addMarketplace(FIXTURE_DIR);
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
				scope: "user",
			});
			await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
				scope: "project",
			});
			await bumpCatalogVersion("2.0.0");

			const entries = await ctx.manager.upgradePluginAcrossScopes("hello-plugin@test-marketplace");

			expect(entries).toHaveLength(2);
			const scopes = entries.map(e => e.scope).sort();
			expect(scopes).toEqual(["project", "user"]);
			for (const entry of entries) {
				expect(entry.version).toBe("2.0.0");
			}
		});
	});

	it("refreshMarketplaces re-fetches a marketplace even when updatedAt is fresh", async () => {
		const sourceDir = path.join(ctx.tmpDir, "fresh-source");
		fs.cpSync(FIXTURE_DIR, sourceDir, { recursive: true });
		await ctx.manager.addMarketplace(sourceDir);

		const sourceCatalogPath = path.join(sourceDir, ".xcsh-plugin", "marketplace.json");
		const sourceCatalog = JSON.parse(fs.readFileSync(sourceCatalogPath, "utf8")) as {
			plugins: Array<{ version?: string }>;
		};
		sourceCatalog.plugins[0].version = "2.0.0";
		fs.writeFileSync(sourceCatalogPath, `${JSON.stringify(sourceCatalog, null, 2)}\n`);

		const result = await ctx.manager.refreshMarketplaces();

		expect(result).toEqual({ successful: ["test-marketplace"], failed: [] });
		const plugins = await ctx.manager.listAvailablePlugins("test-marketplace");
		expect(plugins[0].version).toBe("2.0.0");
	});

	it("refreshMarketplaces updates successful sources independently and reports failures", async () => {
		const healthySource = path.join(ctx.tmpDir, "healthy-source");
		const failingSource = path.join(ctx.tmpDir, "failing-source");
		fs.cpSync(FIXTURE_DIR, healthySource, { recursive: true });
		fs.cpSync(FIXTURE_DIR, failingSource, { recursive: true });

		const failingCatalogPath = path.join(failingSource, ".xcsh-plugin", "marketplace.json");
		const failingCatalog = JSON.parse(fs.readFileSync(failingCatalogPath, "utf8")) as { name: string };
		failingCatalog.name = "failing-marketplace";
		fs.writeFileSync(failingCatalogPath, `${JSON.stringify(failingCatalog, null, 2)}\n`);

		await ctx.manager.addMarketplace(healthySource);
		await ctx.manager.addMarketplace(failingSource);

		const healthyCatalogPath = path.join(healthySource, ".xcsh-plugin", "marketplace.json");
		const healthyCatalog = JSON.parse(fs.readFileSync(healthyCatalogPath, "utf8")) as {
			plugins: Array<{ version?: string }>;
		};
		healthyCatalog.plugins[0].version = "2.0.0";
		fs.writeFileSync(healthyCatalogPath, `${JSON.stringify(healthyCatalog, null, 2)}\n`);
		fs.rmSync(failingSource, { recursive: true, force: true });

		const result = await ctx.manager.refreshMarketplaces();

		expect(result).toEqual({
			successful: ["test-marketplace"],
			failed: ["failing-marketplace"],
		});
		expect((await ctx.manager.listAvailablePlugins("test-marketplace"))[0].version).toBe("2.0.0");
		expect((await ctx.manager.listAvailablePlugins("failing-marketplace"))[0].version).toBe("1.0.0");
	});

	it("refreshMarketplaces can refresh only the selected marketplace", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);

		const result = await ctx.manager.refreshMarketplaces(["test-marketplace"]);

		expect(result).toEqual({ successful: ["test-marketplace"], failed: [] });
	});

	it("reports a failed refresh and a clear error when no cached catalog remains", async () => {
		const sourceDir = path.join(ctx.tmpDir, "unavailable-source");
		fs.cpSync(FIXTURE_DIR, sourceDir, { recursive: true });
		const entry = await ctx.manager.addMarketplace(sourceDir);
		fs.rmSync(sourceDir, { recursive: true, force: true });
		fs.rmSync(entry.catalogPath, { force: true });

		const result = await ctx.manager.refreshMarketplaces();

		expect(result).toEqual({ successful: [], failed: ["test-marketplace"] });
		await expect(ctx.manager.listAvailablePlugins("test-marketplace")).rejects.toThrow(
			/Marketplace catalog not found/,
		);
	});
});
