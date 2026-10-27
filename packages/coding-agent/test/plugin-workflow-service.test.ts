import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { readFile as readCachedFile } from "../src/capability/fs";
import { PluginWorkflowService } from "../src/services/plugin-workflow";
import { VoiceToolRetry } from "../src/session/voice-tool-retry";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "xcsh-plugin-workflow-"));
	const source = join(root, "source");
	for (const name of ["platform", "kvm"]) {
		await mkdir(join(source, name, ".xcsh-plugin"), { recursive: true });
		await writeFile(join(source, name, ".xcsh-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0" }));
		await writeFile(join(source, name, "README.md"), "verified source\n");
	}
	await mkdir(join(source, ".xcsh-plugin"), { recursive: true });
	await writeFile(
		join(source, ".xcsh-plugin/marketplace.json"),
		JSON.stringify({
			name: "qualification",
			owner: { name: "Qualification" },
			plugins: ["platform", "kvm"].map(name => ({
				name,
				version: "1.0.0",
				source: `./${name}`,
				lifecycle: {
					mode: "content",
					integrations: [],
					requirements: [],
					collectedData: [],
					pluginDependencies: name === "kvm" ? ["platform"] : [],
					setupRequired: false,
				},
			})),
		}),
	);
	const options = {
		marketplacesRegistryPath: join(root, "marketplaces.json"),
		installedRegistryPath: join(root, "user-installed.json"),
		projectInstalledRegistryPath: join(root, "project/.xcsh/plugins/installed_plugins.json"),
		marketplacesCacheDir: join(root, "catalog-cache"),
		pluginsCacheDir: join(root, "plugin-cache"),
		includeBuiltinMarketplace: false,
	};
	const service = new PluginWorkflowService(join(root, "project"), options);
	await service.manager.addMarketplace(source);
	return { root, source, options, service, close: () => rm(root, { recursive: true, force: true }) };
}

test("native discovery/plan leave installed registries absent and the catalog unchanged", async () => {
	const f = await fixture();
	try {
		const before = await readFile(f.options.marketplacesRegistryPath);
		await f.service.catalogs();
		await f.service.list();
		const plan = await f.service.plan("kvm", "qualification");
		expect(plan.dependencyPlan.map(item => item.pluginId)).toEqual(["platform@qualification", "kvm@qualification"]);
		expect(plan.changes).toHaveLength(2);
		expect(await readFile(f.options.marketplacesRegistryPath)).toEqual(before);
		expect(await Bun.file(f.options.projectInstalledRegistryPath).exists()).toBe(false);
		expect(await Bun.file(f.options.installedRegistryPath).exists()).toBe(false);
	} finally {
		await f.close();
	}
});

test("a repeat install verifies both sources and preserves registry bytes and timestamps", async () => {
	const f = await fixture();
	try {
		await f.service.install(await f.service.plan("kvm", "qualification"));
		const before = await readFile(f.options.projectInstalledRegistryPath);
		const repeat = await f.service.plan("kvm", "qualification");
		expect(repeat.changes).toEqual([]);
		expect(await f.service.install(repeat)).toMatchObject({ state: "already-installed", changed: false });
		expect(await readFile(f.options.projectInstalledRegistryPath)).toEqual(before);
	} finally {
		await f.close();
	}
});

test("an installed user copy does not satisfy a fresh project installation", async () => {
	const f = await fixture();
	try {
		await f.service.install(await f.service.plan("kvm", "qualification", "user"));
		const userBefore = await readFile(f.options.installedRegistryPath);
		const project = await f.service.plan("kvm", "qualification", "project");
		expect(project.changes).toHaveLength(2);
		await f.service.install(project);
		expect(await readFile(f.options.installedRegistryPath)).toEqual(userBefore);
	} finally {
		await f.close();
	}
});

test("a damaged immutable cache is rejected and retained without registry changes", async () => {
	const f = await fixture();
	try {
		await f.service.install(await f.service.plan("kvm", "qualification"));
		const before = await readFile(f.options.projectInstalledRegistryPath);
		const registry = JSON.parse(before.toString());
		const changed = join(registry.plugins["kvm@qualification"][0].installPath, "README.md");
		await writeFile(changed, "retained modification\n");
		const plan = await f.service.plan("kvm", "qualification");
		expect(plan.changes.some(item => item.action === "repair-required")).toBe(true);
		await expect(f.service.install(plan)).rejects.toThrow("repair");
		expect(await readFile(changed, "utf8")).toBe("retained modification\n");
		expect(await readFile(f.options.projectInstalledRegistryPath)).toEqual(before);
	} finally {
		await f.close();
	}
});

test("source changes invalidate the reviewed plan before any install writes", async () => {
	const f = await fixture();
	try {
		const plan = await f.service.plan("kvm", "qualification");
		await writeFile(join(f.source, "kvm/README.md"), "changed source\n");
		await expect(f.service.install(plan)).rejects.toThrow("changed");
		expect(await Bun.file(f.options.projectInstalledRegistryPath).exists()).toBe(false);
	} finally {
		await f.close();
	}
});

test("failed prerequisite setup rolls back registration and cannot become a false no-op", async () => {
	const f = await fixture();
	try {
		class FailedSetup extends PluginWorkflowService {
			protected override async applyInstallSetup(): Promise<boolean> {
				throw new Error("fixture prerequisite failure");
			}
		}
		const service = new FailedSetup(join(f.root, "project"), f.options);
		await expect(service.install(await service.plan("kvm", "qualification"))).rejects.toThrow(
			"prior registration was restored",
		);
		expect(await Bun.file(f.options.projectInstalledRegistryPath).exists()).toBe(false);
		expect((await service.plan("kvm", "qualification")).changes).toHaveLength(2);
	} finally {
		await f.close();
	}
});

test("source drift during cache installation is rejected before setup and preserves prior registration", async () => {
	const f = await fixture();
	try {
		await f.service.install(await f.service.plan("kvm", "qualification"));
		const before = await readFile(f.options.projectInstalledRegistryPath);
		await writeFile(join(f.source, "kvm/README.md"), "reviewed update\n");
		const reviewed = await f.service.plan("kvm", "qualification");
		const originalInstall = f.service.manager.installPlugin.bind(f.service.manager);
		f.service.manager.installPlugin = async (...args) => {
			await writeFile(join(f.source, "kvm/README.md"), "changed after review\n");
			return originalInstall(...args);
		};
		await expect(f.service.install(reviewed)).rejects.toThrow("prior registration was restored");
		expect(await readFile(f.options.projectInstalledRegistryPath)).toEqual(before);
		const retained = JSON.parse(before.toString()).plugins["kvm@qualification"][0].installPath;
		expect(await readFile(join(retained, "README.md"), "utf8")).toBe("verified source\n");
	} finally {
		await f.close();
	}
});

test("installation invalidates a cached absent registry before prerequisite discovery", async () => {
	const f = await fixture();
	try {
		expect(await readCachedFile(f.options.projectInstalledRegistryPath)).toBeNull();
		class SetupDiscovery extends PluginWorkflowService {
			protected override async applyInstallSetup(): Promise<boolean> {
				const registry = await readCachedFile(f.options.projectInstalledRegistryPath);
				expect(registry).not.toBeNull();
				expect(JSON.parse(registry!).plugins["kvm@qualification"]).toHaveLength(1);
				return true;
			}
		}
		const service = new SetupDiscovery(join(f.root, "project"), f.options);
		await service.install(await service.plan("kvm", "qualification"));
	} finally {
		await f.close();
	}
});

test("voice failure preserves verified registration rollback without replaying setup", async () => {
	const f = await fixture();
	try {
		let setups = 0;
		class FailedSetup extends PluginWorkflowService {
			protected override async applyInstallSetup(): Promise<boolean> {
				setups++;
				throw new Error("fixture setup failed");
			}
		}
		const service = new FailedSetup(join(f.root, "project"), f.options);
		const plan = await service.plan("kvm", "qualification");
		const retry = new VoiceToolRetry();
		let caught: unknown;
		try {
			await retry.run("install", "mutation", () => service.install(plan));
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AgentToolError);
		expect((caught as AgentToolError).result.details).toMatchObject({
			registrationRestored: true,
			installationCompleted: false,
			prerequisiteOutcome: "unverified",
		});
		expect(setups).toBe(1);
		expect(await Bun.file(f.options.projectInstalledRegistryPath).exists()).toBe(false);
	} finally {
		await f.close();
	}
});
