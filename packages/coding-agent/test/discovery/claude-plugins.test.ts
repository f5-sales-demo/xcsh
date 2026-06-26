import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearCache as clearFsCache } from "@f5-sales-demo/xcsh/capability/fs";
import {
	clearXcshPluginRootsCache,
	listXcshPluginRoots,
	parseXcshPluginsRegistry,
} from "@f5-sales-demo/xcsh/discovery/helpers";
import { discoverAgents } from "@f5-sales-demo/xcsh/task/discovery";

describe("parseXcshPluginsRegistry", () => {
	test("parses valid registry", () => {
		const content = JSON.stringify({
			version: 2,
			plugins: {
				"my-plugin@marketplace": [
					{
						scope: "user",
						installPath: "/path/to/plugin",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		});

		const result = parseXcshPluginsRegistry(content);
		expect(result).not.toBeNull();
		expect(result?.version).toBe(2);
		expect(result?.plugins["my-plugin@marketplace"]).toHaveLength(1);
	});

	test("returns null for invalid JSON", () => {
		expect(parseXcshPluginsRegistry("not json")).toBeNull();
	});

	test("returns null for missing version", () => {
		const content = JSON.stringify({ plugins: {} });
		expect(parseXcshPluginsRegistry(content)).toBeNull();
	});

	test("returns null for missing plugins", () => {
		const content = JSON.stringify({ version: 2 });
		expect(parseXcshPluginsRegistry(content)).toBeNull();
	});

	test("returns null for null plugins", () => {
		const content = JSON.stringify({ version: 2, plugins: null });
		expect(parseXcshPluginsRegistry(content)).toBeNull();
	});
});

describe("listXcshPluginRoots", () => {
	let tempDir: string;

	beforeEach(async () => {
		clearXcshPluginRootsCache();
		clearFsCache();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugins-test-"));
	});

	afterEach(async () => {
		clearXcshPluginRootsCache();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("returns empty roots when no registry file exists", async () => {
		const result = await listXcshPluginRoots(tempDir);
		expect(result.roots).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	test("parses plugin with user scope", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry = {
			version: 2,
			plugins: {
				"test-plugin@test-market": [
					{
						scope: "user",
						installPath: "/path/to/test-plugin",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await listXcshPluginRoots(tempDir);
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0]).toEqual({
			id: "test-plugin@test-market",
			marketplace: "test-market",
			plugin: "test-plugin",
			version: "1.0.0",
			path: "/path/to/test-plugin",
			scope: "user",
		});
	});

	test("parses plugin with project scope", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry = {
			version: 2,
			plugins: {
				"project-plugin@market": [
					{
						scope: "project",
						installPath: "/path/to/project-plugin",
						version: "2.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await listXcshPluginRoots(tempDir);
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].scope).toBe("project");
	});

	test("handles multiple entries per plugin ID", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry = {
			version: 2,
			plugins: {
				"multi-plugin@market": [
					{
						scope: "user",
						installPath: "/path/to/v2",
						version: "2.0.0",
						installedAt: "2025-01-02T00:00:00Z",
						lastUpdated: "2025-01-02T00:00:00Z",
					},
					{
						scope: "project",
						installPath: "/path/to/v1",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await listXcshPluginRoots(tempDir);
		// Should return both entries, not just the first one
		expect(result.roots).toHaveLength(2);
		expect(result.roots[0].version).toBe("2.0.0");
		expect(result.roots[0].scope).toBe("user");
		expect(result.roots[1].version).toBe("1.0.0");
		expect(result.roots[1].scope).toBe("project");
	});

	test("warns on invalid plugin ID format", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry = {
			version: 2,
			plugins: {
				"invalid-no-at-symbol": [
					{
						scope: "user",
						installPath: "/path/to/invalid",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await listXcshPluginRoots(tempDir);
		expect(result.roots).toHaveLength(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("Invalid plugin ID format");
	});

	test("warns on entry without installPath", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry = {
			version: 2,
			plugins: {
				"no-path@market": [
					{
						scope: "user",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await listXcshPluginRoots(tempDir);
		expect(result.roots).toHaveLength(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("has no installPath");
	});

	test("caches results for same home directory", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry: {
			version: number;
			plugins: Record<
				string,
				Array<{ scope: string; installPath: string; version: string; installedAt: string; lastUpdated: string }>
			>;
		} = {
			version: 2,
			plugins: {
				"cached-plugin@market": [
					{
						scope: "user",
						installPath: "/path/to/cached",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		// First call
		const result1 = await listXcshPluginRoots(tempDir);
		expect(result1.roots).toHaveLength(1);

		// Modify the file
		registry.plugins["new-plugin@market"] = [
			{
				scope: "user",
				installPath: "/path/to/new",
				version: "1.0.0",
				installedAt: "2025-01-01T00:00:00Z",
				lastUpdated: "2025-01-01T00:00:00Z",
			},
		];
		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		// Second call should return cached result (still 1 plugin)
		const result2 = await listXcshPluginRoots(tempDir);
		expect(result2.roots).toHaveLength(1);

		// After clearing cache, should see new plugin
		clearXcshPluginRootsCache();
		clearFsCache(); // Also clear fs cache so the file is re-read
		const result3 = await listXcshPluginRoots(tempDir);
		expect(result3.roots).toHaveLength(2);
	});

	test("defaults scope to user when not specified", async () => {
		const pluginsDir = path.join(tempDir, ".xcsh", "plugins");
		await fs.mkdir(pluginsDir, { recursive: true });

		const registry = {
			version: 2,
			plugins: {
				"no-scope@market": [
					{
						installPath: "/path/to/no-scope",
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await listXcshPluginRoots(tempDir);
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].scope).toBe("user");
	});
});

describe("discoverAgents plugin precedence", () => {
	let tempDir: string;

	beforeEach(async () => {
		clearXcshPluginRootsCache();
		clearFsCache();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-plugins-precedence-test-"));
	});

	afterEach(async () => {
		clearXcshPluginRootsCache();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("prefers project-scoped plugin agent over user-scoped plugin agent", async () => {
		const pluginRegistryDir = path.join(tempDir, ".xcsh", "plugins");
		const projectPluginPath = path.join(tempDir, "plugins", "project");
		const userPluginPath = path.join(tempDir, "plugins", "user");
		const agentName = "plugin-precedence-test-agent";

		await fs.mkdir(pluginRegistryDir, { recursive: true });
		await fs.mkdir(path.join(projectPluginPath, "agents"), { recursive: true });
		await fs.mkdir(path.join(userPluginPath, "agents"), { recursive: true });

		const projectAgent = `---\nname: ${agentName}\ndescription: Project plugin version\n---\nProject scope agent`;
		const userAgent = `---\nname: ${agentName}\ndescription: User plugin version\n---\nUser scope agent`;

		await fs.writeFile(path.join(projectPluginPath, "agents", "shared.md"), projectAgent);
		await fs.writeFile(path.join(userPluginPath, "agents", "shared.md"), userAgent);

		const registry = {
			version: 2,
			plugins: {
				"shared-plugin@market": [
					{
						scope: "user",
						installPath: userPluginPath,
						version: "1.0.0",
						installedAt: "2025-01-01T00:00:00Z",
						lastUpdated: "2025-01-01T00:00:00Z",
					},
					{
						scope: "project",
						installPath: projectPluginPath,
						version: "1.0.1",
						installedAt: "2025-01-02T00:00:00Z",
						lastUpdated: "2025-01-02T00:00:00Z",
					},
				],
			},
		};

		await fs.writeFile(path.join(pluginRegistryDir, "installed_plugins.json"), JSON.stringify(registry));

		const result = await discoverAgents(tempDir, tempDir);
		const found = result.agents.find(agent => agent.name === agentName);

		expect(found).toBeDefined();
		expect(found?.source).toBe("project");
		expect(found?.filePath).toContain(projectPluginPath);
	});
});
