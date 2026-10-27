import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { isEnoent } from "@f5-sales-demo/pi-utils";
import { invalidate as invalidateFsCache } from "../capability/fs";
import { loadIntegrationHandles } from "../cli/plugin-cli";
import { clearXcshPluginRootsCache, resolveOrDefaultProjectRegistryPath } from "../discovery/helpers";
import {
	MarketplaceManager,
	type MarketplaceManagerOptions,
	type PluginDependencyPlanItem,
} from "../extensibility/plugins/marketplace/manager";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
} from "../extensibility/plugins/marketplace/registry";
import { createSetupStepRunner, executeInstallAuthorizedSetup } from "../integrations/setup";

export interface PluginWorkflowPlan {
	plugin: string;
	marketplace: string;
	scope: "user" | "project";
	fingerprint: string;
	sourceFingerprint: string;
	dependencyPlan: PluginDependencyPlanItem[];
	changes: Array<{ pluginId: string; action: "install" | "update" | "repair-required" | "setup" }>;
	lifecycle: { setupRequired: boolean; setupAuthorization?: "separate" | "install" };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Native adapter over the same marketplace cache and installation-authorized setup used by the CLI. */
export class PluginWorkflowService {
	readonly manager: MarketplaceManager;
	constructor(
		private readonly cwd: string,
		private readonly options: MarketplaceManagerOptions,
		private readonly environment: Readonly<Record<string, string>> = {},
	) {
		this.manager = new MarketplaceManager({
			...options,
			clearPluginRootsCache: extraPaths => {
				invalidateFsCache(options.installedRegistryPath);
				invalidateFsCache(options.marketplacesRegistryPath);
				for (const target of extraPaths ?? []) invalidateFsCache(target);
				clearXcshPluginRootsCache({ rewarm: false });
				options.clearPluginRootsCache?.(extraPaths);
			},
		});
	}
	static async create(
		cwd: string,
		environment: Readonly<Record<string, string>> = {},
	): Promise<PluginWorkflowService> {
		return new PluginWorkflowService(
			cwd,
			{
				marketplacesRegistryPath: getMarketplacesRegistryPath(),
				installedRegistryPath: getInstalledPluginsRegistryPath(),
				projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(cwd),
				marketplacesCacheDir: getMarketplacesCacheDir(),
				pluginsCacheDir: getPluginsCacheDir(),
			},
			environment,
		);
	}
	async catalogs() {
		return (await this.manager.listMarketplaces()).map(item => ({
			name: item.name,
			enabled: item.enabled,
			builtIn: item.builtIn === true,
		}));
	}
	async list(scope: "user" | "project" = "project") {
		return (await this.manager.listInstalledPlugins())
			.filter(item => item.scope === scope)
			.map(item => ({
				id: item.id,
				name: item.id.split("@")[0],
				marketplace: item.id.split("@")[1],
				version: item.entries[0]?.version,
				scope: item.scope,
				enabled: item.effectiveEnabled !== false,
			}));
	}
	#registry(scope: "user" | "project") {
		const target =
			scope === "project" ? this.options.projectInstalledRegistryPath : this.options.installedRegistryPath;
		if (!target) throw new Error("Project-scoped plugin registry unavailable");
		return target;
	}
	#receipt(scope: "user" | "project", plugin: string, marketplace: string) {
		return path.join(
			path.dirname(this.#registry(scope)),
			"installation-receipts",
			digest({ plugin, marketplace }) + ".json",
		);
	}
	async plan(
		plugin: string,
		marketplace: string,
		scope: "user" | "project" = "project",
		verifyLegacySetup = true,
	): Promise<PluginWorkflowPlan> {
		const dependencyPlan = await this.manager.getPluginDependencyPlan(plugin, marketplace, scope);
		const inspections = await Promise.all(
			dependencyPlan.map(item =>
				this.manager.inspectPluginInstallation(item.pluginId.split("@")[0], marketplace, scope),
			),
		);
		for (let index = 0; index < dependencyPlan.length; index++)
			dependencyPlan[index].version = inspections[index].version;
		const sourceFingerprint = digest(
			inspections.map(item => ({
				pluginId: item.pluginId,
				version: item.version,
				sourceDigest: item.sourceDigest,
				lifecycle: item.lifecycle,
			})),
		);
		const changes: PluginWorkflowPlan["changes"] = inspections.flatMap(item =>
			item.state === "installed"
				? []
				: [{ pluginId: item.pluginId, action: item.state === "missing" ? "install" : item.state }],
		);
		const root = inspections.at(-1)!;
		if (!changes.length && root.lifecycle.setupRequired && root.lifecycle.setupAuthorization === "install") {
			let completed = false;
			try {
				const receipt = JSON.parse(await fs.readFile(this.#receipt(scope, plugin, marketplace), "utf8"));
				completed = receipt.sourceFingerprint === sourceFingerprint && receipt.setupCompleted === true;
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
			if (!completed && verifyLegacySetup) {
				const handles = (
					await loadIntegrationHandles(os.homedir(), this.cwd, {
						get: key => (key === "bash.environment" ? this.environment : undefined),
					})
				).filter(handle => handle.plugin?.split("@")[0] === plugin);
				const states = await Promise.all(handles.map(handle => handle.get()));
				completed = states.length > 0 && states.every(state => state.state === "ready");
			}
			if (!completed) changes.push({ pluginId: root.pluginId, action: "setup" });
		}
		return {
			plugin,
			marketplace,
			scope,
			sourceFingerprint,
			dependencyPlan,
			changes,
			lifecycle: root.lifecycle,
			fingerprint: digest({
				sourceFingerprint,
				dependencyPlan,
				changes,
				installed: inspections.map(item => item.installed),
			}),
		};
	}
	protected async applyInstallSetup(current: PluginWorkflowPlan, signal?: AbortSignal): Promise<boolean> {
		const lifecycle = current.lifecycle;
		const handles =
			lifecycle.setupRequired && lifecycle.setupAuthorization === "install"
				? (
						await loadIntegrationHandles(os.homedir(), this.cwd, {
							get: key => (key === "bash.environment" ? this.environment : undefined),
						})
					).filter(handle => handle.plugin?.split("@")[0] === current.plugin)
				: [];
		const result = await executeInstallAuthorizedSetup({
			plugin: current.plugin,
			lifecycle,
			trigger: "direct-install",
			handles,
			signal,
			run: createSetupStepRunner(name => this.environment[name] ?? process.env[name], {
				cwd: this.cwd,
				environment: this.environment,
			}),
			review: async () => {},
		});
		return !lifecycle.setupRequired || lifecycle.setupAuthorization !== "install" || result?.state === "ready";
	}

	async install(reviewed: PluginWorkflowPlan, signal?: AbortSignal) {
		const check = () => {
			if (signal?.aborted) throw new Error("Plugin installation cancelled");
		};
		check();
		const current = await this.plan(reviewed.plugin, reviewed.marketplace, reviewed.scope);
		if (current.fingerprint !== reviewed.fingerprint) throw new Error("Reviewed plugin installation changed");
		if (!current.changes.length)
			return { state: "already-installed", changed: false, dependencyPlan: current.dependencyPlan };
		if (current.changes.some(item => item.action === "repair-required"))
			throw new Error("Installed cache requires repair; installation preserved");
		const registryPath = this.#registry(reviewed.scope);
		let before: Buffer | undefined;
		try {
			before = await fs.readFile(registryPath);
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
		try {
			if (current.changes.some(item => item.action !== "setup")) {
				await this.manager.installPlugin(current.plugin, current.marketplace, {
					scope: current.scope,
					force: true,
					immutable: true,
				});
			}
			check();
			const installedPlan = await this.plan(current.plugin, current.marketplace, current.scope, false);
			if (
				installedPlan.sourceFingerprint !== current.sourceFingerprint ||
				installedPlan.changes.some(item => item.action !== "setup")
			)
				throw new Error("Installed source does not match the reviewed plugin plan");
			const setupCompleted = await this.applyInstallSetup(current, signal);
			check();
			const receipt = { sourceFingerprint: current.sourceFingerprint, setupCompleted };
			if (!receipt.setupCompleted)
				throw new Error("Plugin installed source but installation prerequisites remain incomplete");
			const receiptPath = this.#receipt(current.scope, current.plugin, current.marketplace);
			await fs.mkdir(path.dirname(receiptPath), { recursive: true });
			const temporary = receiptPath + ".tmp";
			await fs.writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
			await fs.rename(temporary, receiptPath);
			return {
				state: "installed",
				changed: true,
				dependencyPlan: current.dependencyPlan,
				prerequisitesReady: receipt.setupCompleted,
			};
		} catch (error) {
			if (before) await fs.writeFile(registryPath, before);
			else await fs.rm(registryPath, { force: true });
			invalidateFsCache(registryPath);
			clearXcshPluginRootsCache({ rewarm: false });
			throw new AgentToolError(
				"Plugin installation failed; prior registration was restored. Prerequisite effects remain unverified.",
				{
					content: [
						{
							type: "text",
							text: "Plugin installation failed; prior registration was restored. Prerequisite effects remain unverified.",
						},
					],
					details: { registrationRestored: true, installationCompleted: false, prerequisiteOutcome: "unverified" },
				},
			);
		}
	}
}
