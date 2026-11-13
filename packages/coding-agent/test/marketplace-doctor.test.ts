import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectMarketplacePlugins } from "../src/extensibility/plugins/marketplace/doctor";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "marketplace-doctor-"));
	roots.push(root);
	const paths = {
		marketplacesRegistryPath: join(root, "marketplaces.json"),
		userRegistryPath: join(root, "user.json"),
		projectRegistryPath: join(root, "project.json"),
	};
	const directories = { platform: join(root, "platform"), gcloud: join(root, "gcloud") };
	const plugins = ["platform", "gcloud"].map(name => ({
		name,
		version: "1.0.0",
		source: `./${name}`,
		extensions: ["runtime/index.js"],
		lifecycle: {
			mode: "integrated",
			integrations: [name],
			requirements: [],
			setupRequired: false,
			collectedData: [],
			pluginDependencies: name === "gcloud" ? ["platform"] : [],
		},
	}));
	for (const plugin of plugins) {
		const directory = directories[plugin.name as keyof typeof directories];
		await mkdir(join(directory, ".xcsh-plugin"), { recursive: true });
		await mkdir(join(directory, "runtime"));
		await writeFile(join(directory, ".xcsh-plugin/plugin.json"), JSON.stringify(plugin));
		await writeFile(join(directory, "runtime/index.js"), "export default function() {}\n");
	}
	const catalog = join(root, "catalog.json");
	await writeFile(catalog, JSON.stringify({ name: "fixture", owner: { name: "fixture" }, plugins }));
	await writeFile(
		paths.marketplacesRegistryPath,
		JSON.stringify({
			version: 2,
			marketplaces: [
				{
					name: "fixture",
					sourceType: "local",
					sourceUri: root,
					catalogPath: catalog,
					addedAt: "2026-11-13T00:00:00Z",
					updatedAt: "2026-11-13T00:00:00Z",
					enabled: true,
					builtIn: false,
				},
			],
		}),
	);
	const entry = (name: keyof typeof directories, scope: "user" | "project", extra = {}) => ({
		scope,
		installPath: directories[name],
		version: "1.0.0+snapshot.example",
		enabled: true,
		installedAt: "2026-11-13T00:00:00Z",
		lastUpdated: "2026-11-13T00:00:00Z",
		...extra,
	});
	const user = { version: 2, plugins: { "platform@fixture": [entry("platform", "user")] } };
	const project = { version: 2, plugins: { "gcloud@fixture": [entry("gcloud", "project")] } };
	const save = async () => {
		await writeFile(paths.userRegistryPath, JSON.stringify(user));
		await writeFile(paths.projectRegistryPath, JSON.stringify(project));
	};
	await save();
	return { root, paths, directories, user, project, save, entry, plugins };
}
it("diagnoses real project sources and user dependencies without writing registry bytes", async () => {
	const f = await fixture();
	const before = await Promise.all(Object.values(f.paths).map(p => readFile(p)));
	const result = await inspectMarketplacePlugins(f.paths);
	expect(result.hasInstallations).toBe(true);
	expect(result.checks.filter(c => c.status === "error")).toEqual([]);
	expect(result.checks.some(c => c.name.includes("project:gcloud@fixture"))).toBe(true);
	expect(result.checks.some(c => c.name.includes("user:platform@fixture"))).toBe(true);
	expect(await Promise.all(Object.values(f.paths).map(p => readFile(p)))).toEqual(before);
});
it("respects explicit scopes and does not satisfy a user dependency from a project", async () => {
	const f = await fixture();
	const project = await inspectMarketplacePlugins({ ...f.paths, scope: "project" });
	expect(project.checks.some(c => c.name.startsWith("marketplace:user:"))).toBe(false);
	expect(project.checks.filter(c => c.status === "error")).toEqual([]);
	await writeFile(
		f.paths.userRegistryPath,
		JSON.stringify({ version: 2, plugins: { "gcloud@fixture": [f.entry("gcloud", "user")] } }),
	);
	await writeFile(
		f.paths.projectRegistryPath,
		JSON.stringify({ version: 2, plugins: { "platform@fixture": [f.entry("platform", "project")] } }),
	);
	const user = await inspectMarketplacePlugins({ ...f.paths, scope: "user" });
	expect(user.checks.some(c => c.status === "error" && c.name.includes("dependency:platform"))).toBe(true);
});
it("reports broken sources, escaped entrypoints and disabled dependencies", async () => {
	const f = await fixture();
	await rm(join(f.directories.gcloud, "runtime/index.js"));
	expect(
		(await inspectMarketplacePlugins(f.paths)).checks.some(
			c => c.status === "error" && c.name.includes("entrypoint"),
		),
	).toBe(true);
	await writeFile(
		join(f.directories.gcloud, ".xcsh-plugin/plugin.json"),
		JSON.stringify({ ...f.plugins[1], extensions: ["../outside.js"] }),
	);
	expect(
		(await inspectMarketplacePlugins(f.paths)).checks.some(
			c => c.status === "error" && c.name.includes("entrypoint"),
		),
	).toBe(true);
	await f.save();
	f.user.plugins["platform@fixture"][0].enabled = false;
	await f.save();
	expect(
		(await inspectMarketplacePlugins(f.paths)).checks.some(
			c => c.status === "error" && c.name.includes("dependency:platform"),
		),
	).toBe(true);
	await rm(f.directories.platform, { recursive: true });
	expect(
		(await inspectMarketplacePlugins(f.paths)).checks.some(c => c.status === "error" && c.name.includes("source")),
	).toBe(true);
});
it("malformed registries or manifests remain diagnostic errors rather than empty success", async () => {
	const f = await fixture();
	for (const raw of [
		"{",
		JSON.stringify({ version: 2, plugins: [] }),
		JSON.stringify({ version: 2, plugins: { "gcloud@fixture": {} } }),
		JSON.stringify({ version: 2, plugins: { "gcloud@fixture": [f.entry("gcloud", "user")] } }),
	]) {
		await writeFile(f.paths.projectRegistryPath, raw);
		expect((await inspectMarketplacePlugins(f.paths)).checks.some(c => c.status === "error")).toBe(true);
	}
	await f.save();
	await writeFile(join(f.directories.gcloud, ".xcsh-plugin/plugin.json"), "{");
	expect(
		(await inspectMarketplacePlugins(f.paths)).checks.some(c => c.status === "error" && c.name.includes("manifest")),
	).toBe(true);
});
it("empty installations and unrelated missing optional registry paths remain distinct", async () => {
	const f = await fixture();
	await writeFile(f.paths.userRegistryPath, JSON.stringify({ version: 2, plugins: {} }));
	await writeFile(f.paths.projectRegistryPath, JSON.stringify({ version: 2, plugins: {} }));
	const result = await inspectMarketplacePlugins(f.paths);
	expect(result.hasInstallations).toBe(false);
	expect(result.checks.filter(c => c.status === "error")).toEqual([]);
});

it("project doctor verifies dependency sources, nested dependencies and cycles", async () => {
	const f = await fixture();
	await rm(join(f.directories.platform, "runtime/index.js"));
	expect(
		(await inspectMarketplacePlugins({ ...f.paths, scope: "project" })).checks.some(
			c => c.status === "error" && c.name.includes("dependency:platform"),
		),
	).toBe(true);
	await writeFile(join(f.directories.platform, "runtime/index.js"), "export default function(){}");
	await writeFile(
		join(f.directories.platform, ".xcsh-plugin/plugin.json"),
		JSON.stringify({ ...f.plugins[0], lifecycle: { ...f.plugins[0].lifecycle, pluginDependencies: ["missing"] } }),
	);
	expect(
		(await inspectMarketplacePlugins({ ...f.paths, scope: "project" })).checks.some(
			c => c.status === "error" && c.name.includes("dependency:platform"),
		),
	).toBe(true);
	await writeFile(
		f.paths.userRegistryPath,
		JSON.stringify({
			version: 2,
			plugins: { "platform@fixture": [f.entry("platform", "user")], "gcloud@fixture": [f.entry("gcloud", "user")] },
		}),
	);
	await writeFile(
		join(f.directories.platform, ".xcsh-plugin/plugin.json"),
		JSON.stringify({ ...f.plugins[0], lifecycle: { ...f.plugins[0].lifecycle, pluginDependencies: ["gcloud"] } }),
	);
	expect(
		(await inspectMarketplacePlugins({ ...f.paths, scope: "user" })).checks.some(
			c => c.status === "error" && c.name.includes("dependency"),
		),
	).toBe(true);
});
