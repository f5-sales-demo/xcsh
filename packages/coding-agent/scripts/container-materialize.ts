import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import provenance from "../src/extensibility/plugins/marketplace/builtin-marketplace.provenance.json";
import snapshot from "../src/extensibility/plugins/marketplace/builtin-marketplace-snapshot";
import { getCachedPluginPath } from "../src/extensibility/plugins/marketplace/cache";

const seed = resolve(process.argv[2] ?? "/opt/xcsh/seed");
const repository = resolve(process.argv[3] ?? "/tmp/xcsh-marketplace");
const home = "/home/xcsh/.xcsh";
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
async function run(argv: string[], cwd?: string) {
	const child = Bun.spawn(argv, { cwd, stdout: "inherit", stderr: "inherit" });
	if ((await child.exited) !== 0) throw new Error(`Build command failed: ${argv[0]}`);
}
if (hash(snapshot) !== provenance.sha256) throw new Error("Embedded marketplace provenance mismatch");
await run(["git", "clone", "--no-checkout", provenance.repository, repository]);
await run(["git", "checkout", "--detach", provenance.commit], repository);
const catalog = JSON.parse(snapshot);
if (catalog.plugins.length !== 23) throw new Error("Expected the agreed 23-plugin marketplace suite");
const sourceCatalog = await readFile(join(repository, provenance.sourcePath));
if (hash(sourceCatalog) !== provenance.sha256) throw new Error("Marketplace source differs from embedded snapshot");
const registry: Record<string, unknown[]> = {};
const inventory: unknown[] = [];
for (const plugin of catalog.plugins) {
	if (typeof plugin.source !== "string" || !plugin.source.startsWith("./plugins/")) {
		throw new Error("Container materialization requires pinned marketplace-local plugin sources");
	}
	const source = resolve(repository, plugin.source);
	if (!source.startsWith(`${repository}/plugins/`)) throw new Error("Invalid plugin source path");
	const relativeCache = getCachedPluginPath("plugins/cache/plugins", catalog.name, plugin.name, plugin.version);
	const target = join(seed, relativeCache);
	await cp(source, target, { recursive: true });
	await rm(join(target, ".git"), { recursive: true, force: true });
	// Install declared runtime dependencies, but never execute plugin setup or install hooks.
	if (await Bun.file(join(target, "package.json")).exists()) {
		await run(["bun", "install", "--production", "--ignore-scripts", "--omit=peer"], target);
	}
	const files: Record<string, string> = {};
	const visit = async (directory: string, prefix = "") => {
		for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			const name = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(join(directory, entry.name), name);
			else if (entry.isFile()) files[name] = hash(await readFile(join(directory, entry.name)));
		}
	};
	await visit(target);
	registry[`${plugin.name}@${catalog.name}`] = [
		{
			scope: "user",
			installPath: join(home, relativeCache),
			version: plugin.version,
			installedAt: provenance.capturedAt,
			lastUpdated: provenance.capturedAt,
			gitCommitSha: provenance.commit,
			enabled: true,
		},
	];
	inventory.push({
		name: plugin.name,
		version: plugin.version,
		sourceCommit: provenance.commit,
		requirements: plugin.lifecycle?.requirements ?? [],
		integrations: plugin.lifecycle?.integrations ?? [],
		treeSha256: hash(JSON.stringify(files)),
		files,
	});
}
const catalogRelative = `plugins/cache/marketplaces/${catalog.name}/marketplace.json`;
await mkdir(join(seed, "plugins/cache/marketplaces", catalog.name), { recursive: true });
await writeFile(join(seed, catalogRelative), snapshot);
await writeFile(
	join(seed, "marketplaces.json"),
	JSON.stringify(
		{
			version: 2,
			marketplaces: [
				{
					name: catalog.name,
					sourceType: "github",
					sourceUri: "f5-sales-demo/marketplace",
					catalogPath: join(home, catalogRelative),
					addedAt: provenance.capturedAt,
					updatedAt: provenance.capturedAt,
					enabled: true,
					builtIn: true,
				},
			],
		},
		null,
		2,
	),
);
await writeFile(
	join(seed, "plugins/installed_plugins.json"),
	JSON.stringify({ version: 2, plugins: registry }, null, 2),
);
await mkdir(join(seed, "agent"), { recursive: true });
await symlink("/opt/xcsh/python-env", join(seed, "python-env"));
await writeFile(
	join(dirname(seed), "plugin-manifest.json"),
	JSON.stringify({ schemaVersion: 1, marketplace: provenance, plugins: inventory }, null, 2),
);
await rm(repository, { recursive: true });
