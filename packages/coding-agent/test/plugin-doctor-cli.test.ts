import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const cli = resolve(import.meta.dir, "../src/cli.ts");
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "plugin-doctor-cli-"));
	roots.push(root);
	const config = join(root, "config"),
		project = join(root, "project"),
		plugin = join(root, "cached-plugin");
	await mkdir(join(config, "plugins"), { recursive: true });
	await mkdir(join(project, ".xcsh/plugins"), { recursive: true });
	await mkdir(join(plugin, ".xcsh-plugin"), { recursive: true });
	await mkdir(join(plugin, "runtime"));
	const manifest = {
		name: "example",
		version: "1.0.0",
		extensions: ["runtime/index.js"],
		lifecycle: {
			mode: "integrated",
			integrations: ["example"],
			requirements: [],
			setupRequired: false,
			collectedData: [],
			pluginDependencies: [],
		},
	};
	await writeFile(join(plugin, ".xcsh-plugin/plugin.json"), JSON.stringify(manifest));
	await writeFile(join(plugin, "runtime/index.js"), "export default function(){}\n");
	const catalog = join(root, "catalog.json");
	await writeFile(
		catalog,
		JSON.stringify({ name: "fixture", owner: { name: "fixture" }, plugins: [{ ...manifest, source: "./plugin" }] }),
	);
	await writeFile(
		join(config, "marketplaces.json"),
		JSON.stringify({
			version: 2,
			marketplaces: [
				{
					name: "fixture",
					catalogPath: catalog,
					sourceType: "local",
					sourceUri: root,
					enabled: true,
					builtIn: false,
					addedAt: "2026-11-13T00:00:00Z",
					updatedAt: "2026-11-13T00:00:00Z",
				},
			],
		}),
	);
	await writeFile(
		join(project, ".xcsh/plugins/installed_plugins.json"),
		JSON.stringify({
			version: 2,
			plugins: {
				"example@fixture": [
					{
						scope: "project",
						installPath: plugin,
						version: "1.0.0",
						installedAt: "2026-11-13T00:00:00Z",
						lastUpdated: "2026-11-13T00:00:00Z",
					},
				],
			},
		}),
	);
	const env = {
		...process.env,
		PI_CONFIG_DIR: relative(homedir(), config),
		PI_CODING_AGENT_DIR: join(config, "agent"),
	};
	const run = async (...flags: string[]) => {
		const child = Bun.spawn([process.execPath, cli, "plugin", "doctor", ...flags], {
			cwd: project,
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, code };
	};
	return { root, config, project, plugin, run };
}
it("normal doctor diagnoses a marketplace project without phantom npm-root warnings", async () => {
	const f = await fixture();
	const result = await f.run("--json");
	expect(result.code).toBe(0);
	const checks = JSON.parse(result.stdout) as Array<{ name: string; status: string }>;
	expect(checks.some(c => c.name.includes("project:example@fixture") && c.status === "ok")).toBe(true);
	expect(checks.filter(c => c.status !== "ok")).toEqual([]);
});
it("JSON and text doctor both fail on missing marketplace entrypoints", async () => {
	const f = await fixture();
	await rm(join(f.plugin, "runtime/index.js"));
	const json = await f.run("--json"),
		text = await f.run();
	expect(json.code).toBe(1);
	expect(text.code).toBe(1);
	expect(
		(JSON.parse(json.stdout) as Array<{ name: string; status: string }>).some(
			c => c.status === "error" && c.name.includes("entrypoint"),
		),
	).toBe(true);
});
it("mixed installation retains legacy failures alongside marketplace diagnostics", async () => {
	const f = await fixture();
	await writeFile(
		join(f.config, "plugins/package.json"),
		JSON.stringify({ dependencies: { "missing-legacy-plugin": "1.0.0" } }),
	);
	const result = await f.run("--json");
	expect(result.code).toBe(1);
	const checks = JSON.parse(result.stdout) as Array<{ name: string; status: string }>;
	expect(checks.some(c => c.name.includes("example@fixture"))).toBe(true);
	expect(checks.some(c => c.name === "node_modules" && c.status === "error")).toBe(true);
});
