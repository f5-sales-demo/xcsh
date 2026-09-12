import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MarketplaceManager } from "../../src/extensibility/plugins/marketplace";
import { StaleActionReviewError } from "../../src/modes/components/reviewed-action";
import {
	executeMarketplaceAddition,
	executePluginInstall,
	executePluginSetup,
	executePluginUpgrade,
	executePluginUpgradeAll,
	prepareMarketplaceAddition,
	preparePluginEnabled,
	preparePluginInstall,
	preparePluginRemoval,
	preparePluginSetup,
	preparePluginUpgrade,
	preparePluginUpgradeAll,
} from "../../src/slash-commands/plugin-reviewed-actions";

const FIXTURE = path.join(import.meta.dir, "..", "marketplace", "fixtures", "valid-marketplace");
const roots: string[] = [];

async function fixture(): Promise<{
	root: string;
	source: string;
	manager: () => MarketplaceManager;
}> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-reviewed-plugin-"));
	roots.push(root);
	const source = path.join(root, "marketplace");
	await fs.cp(FIXTURE, source, { recursive: true });
	const options = {
		marketplacesRegistryPath: path.join(root, "config", "marketplaces.json"),
		installedRegistryPath: path.join(root, "config", "plugins", "installed_plugins.json"),
		projectInstalledRegistryPath: path.join(root, "project", ".xcsh", "plugins", "installed_plugins.json"),
		marketplacesCacheDir: path.join(root, "cache", "marketplaces"),
		pluginsCacheDir: path.join(root, "cache", "plugins"),
	};
	return { root, source, manager: () => new MarketplaceManager(options) };
}

async function setVersion(source: string, version: string): Promise<void> {
	const file = path.join(source, ".xcsh-plugin", "marketplace.json");
	const catalog = (await Bun.file(file).json()) as { plugins: Array<{ version?: string }> };
	catalog.plugins[0]!.version = version;
	await Bun.write(file, `${JSON.stringify(catalog, null, 2)}\n`);
}

async function cloneMarketplace(
	root: string,
	directory: string,
	name: string,
	options: { recommended?: boolean } = {},
): Promise<string> {
	const source = path.join(root, directory);
	await fs.cp(FIXTURE, source, { recursive: true });
	const file = path.join(source, ".xcsh-plugin", "marketplace.json");
	const catalog = (await Bun.file(file).json()) as {
		name: string;
		plugins: Array<{ recommended?: boolean }>;
	};
	catalog.name = name;
	if (options.recommended) catalog.plugins[0]!.recommended = true;
	await Bun.write(file, `${JSON.stringify(catalog, null, 2)}\n`);
	return source;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test("reviewed plugin lifecycle persists install, disable, upgrade, and removal across manager reopen", async () => {
	const f = await fixture();
	await f.manager().addMarketplace(f.source);

	const proposedInstall = await preparePluginInstall(f.manager(), "hello-plugin", "test-marketplace", "user", false);
	expect(proposedInstall.review.changes).toContainEqual({
		field: "Installed version",
		before: "Not installed",
		after: "1.0.0",
	});
	// Merely preparing/cancelling the review cannot create an installed entry.
	expect(await f.manager().listInstalledPlugins()).toEqual([]);
	await executePluginInstall(f.manager(), proposedInstall.target);
	expect((await f.manager().listInstalledPlugins())[0]?.entries[0]?.version).toBe("1.0.0");

	const disable = await preparePluginEnabled(f.manager(), "hello-plugin@test-marketplace", "user", false);
	expect(disable?.review.changes[0]).toEqual({
		field: "Enabled state",
		before: "Enabled",
		after: "Disabled",
	});
	await f.manager().setPluginEnabled(disable!.target.pluginId, false, disable!.target.scope);
	expect((await f.manager().listInstalledPlugins())[0]?.entries[0]?.enabled).toBe(false);
	expect(await preparePluginEnabled(f.manager(), "hello-plugin@test-marketplace", "user", false)).toBeNull();

	await setVersion(f.source, "2.0.0");
	const upgrade = await preparePluginUpgrade(f.manager(), "hello-plugin@test-marketplace", "user");
	expect(upgrade?.review.changes[0]).toEqual({ field: "Installed version", before: "1.0.0", after: "2.0.0" });
	await executePluginUpgrade(f.manager(), upgrade!.target);
	const upgraded = (await f.manager().listInstalledPlugins())[0]?.entries[0];
	expect(upgraded?.version).toBe("2.0.0");
	expect(upgraded?.enabled).toBe(false);

	const removal = await preparePluginRemoval(f.manager(), "hello-plugin@test-marketplace", "user");
	expect(removal.review.scope).toContain("user plugin registry");
	// A cancelled removal leaves the reopened registry byte-for-byte meaningful and installed.
	expect(await f.manager().listInstalledPlugins()).toHaveLength(1);
	await f.manager().uninstallPlugin(removal.target.pluginId, removal.target.scope);
	expect(await f.manager().listInstalledPlugins()).toEqual([]);
});

test("catalog drift invalidates an installation review before any plugin registry write", async () => {
	const f = await fixture();
	await f.manager().addMarketplace(f.source);
	const prepared = await preparePluginInstall(f.manager(), "hello-plugin", "test-marketplace", "project", false);
	await setVersion(f.source, "2.0.0");
	await expect(executePluginInstall(f.manager(), prepared.target)).rejects.toBeInstanceOf(StaleActionReviewError);
	expect(await f.manager().listInstalledPlugins()).toEqual([]);
});

test("marketplace addition resolves identity before review and rejects source drift without persistence", async () => {
	const f = await fixture();
	const prepared = await prepareMarketplaceAddition(f.manager(), f.source);
	expect(prepared.review.identity).toBe("marketplace:test-marketplace");
	expect(await f.manager().listMarketplaces()).toEqual([]);
	await setVersion(f.source, "2.0.0");
	await expect(executeMarketplaceAddition(f.manager(), prepared.target)).rejects.toBeInstanceOf(
		StaleActionReviewError,
	);
	expect(await f.manager().listMarketplaces()).toEqual([]);
});

test("--force remains a reviewed reinstall operation rather than consent", async () => {
	const f = await fixture();
	await f.manager().addMarketplace(f.source);
	await f.manager().installPlugin("hello-plugin", "test-marketplace", { scope: "user" });
	await expect(preparePluginInstall(f.manager(), "hello-plugin", "test-marketplace", "user", false)).rejects.toThrow(
		"Use --force to review a reinstall",
	);
	const forced = await preparePluginInstall(f.manager(), "hello-plugin", "test-marketplace", "user", true);
	expect(forced.review.consequence).toContain("--force controls replacement only; this review is still required");
	expect(forced.review.changes[0]).toMatchObject({ before: "1.0.0", after: "1.0.0" });
});

test("bulk upgrades isolate refresh failures and the next review contains only unresolved scopes", async () => {
	const f = await fixture();
	const second = await cloneMarketplace(f.root, "second-marketplace", "second-marketplace");
	await f.manager().addMarketplace(f.source);
	await f.manager().addMarketplace(second);
	await f.manager().installPlugin("hello-plugin", "test-marketplace", { scope: "user" });
	await f.manager().installPlugin("hello-plugin", "second-marketplace", { scope: "user" });
	await setVersion(f.source, "2.0.0");
	await setVersion(second, "2.0.0");

	const prepared = await preparePluginUpgradeAll(f.manager());
	expect(prepared?.target.updates).toHaveLength(2);
	const offlineSecond = `${second}.offline`;
	await fs.rename(second, offlineSecond);
	const result = await executePluginUpgradeAll(f.manager(), prepared!.target);
	expect(result.completed.map(update => update.pluginId)).toEqual(["hello-plugin@test-marketplace"]);
	expect(result.failed).toMatchObject([
		{ pluginId: "hello-plugin@second-marketplace", error: "marketplace refresh failed" },
	]);

	const reopened = f.manager();
	const versions = new Map(
		(await reopened.listInstalledPlugins()).map(summary => [summary.id, summary.entries[0]?.version]),
	);
	expect(versions.get("hello-plugin@test-marketplace")).toBe("2.0.0");
	expect(versions.get("hello-plugin@second-marketplace")).toBe("1.0.0");
	await fs.rename(offlineSecond, second);
	const retry = await preparePluginUpgradeAll(reopened);
	expect(retry?.target.updates.map(update => update.pluginId)).toEqual(["hello-plugin@second-marketplace"]);
});

test("recommended setup isolates an unavailable marketplace and retries only its unresolved plugin", async () => {
	const f = await fixture();
	const first = await cloneMarketplace(f.root, "recommended-a", "recommended-a", { recommended: true });
	const second = await cloneMarketplace(f.root, "recommended-b", "recommended-b", { recommended: true });
	await f.manager().addMarketplace(first);
	await f.manager().addMarketplace(second);
	const prepared = await preparePluginSetup(f.manager());
	expect(prepared?.target.items).toHaveLength(2);
	await fs.rm(second, { recursive: true, force: true });

	const result = await executePluginSetup(f.manager(), prepared!.target);
	expect(result.installed).toEqual(["hello-plugin@recommended-a"]);
	expect(result.failed).toEqual([{ pluginId: "hello-plugin@recommended-b", error: "marketplace refresh failed" }]);
	const retry = await preparePluginSetup(f.manager());
	expect(retry?.target.items.map(item => `${item.name}@${item.marketplace}`)).toEqual(["hello-plugin@recommended-b"]);
});

test("an unavailable uncached catalog is never reported as up to date or fully configured", async () => {
	const f = await fixture();
	const recommended = await cloneMarketplace(f.root, "recommended", "recommended", { recommended: true });
	await f.manager().addMarketplace(recommended);
	await fs.rm(recommended, { recursive: true, force: true });
	await fs.rm(path.join(f.root, "cache", "marketplaces", "recommended", "marketplace.json"), { force: true });
	await expect(preparePluginUpgradeAll(f.manager())).rejects.toThrow("Could not determine plugin updates");
	await expect(preparePluginSetup(f.manager())).rejects.toThrow("Could not determine recommended setup");
});
