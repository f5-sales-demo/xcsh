import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");
const loader = resolve(import.meta.dir, "../src/extensibility/plugins/loader.ts");
const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(name = "@example/linked") {
	const root = await mkdtemp(join(tmpdir(), "xcsh-linked-plugin-"));
	roots.push(root);
	const config = join(root, "config");
	const project = join(root, "project");
	const plugin = join(root, "plugin");
	await mkdir(project, { recursive: true });
	await mkdir(plugin);
	const metadata = {
		name,
		version: "1.0.0",
		xcsh: { commands: ["hello.md"], extensions: ["extension.ts"], features: { optional: { default: true } } },
	};
	await writeFile(join(plugin, "package.json"), JSON.stringify(metadata));
	await writeFile(join(plugin, "hello.md"), "Say hello.\n");
	await writeFile(join(plugin, "extension.ts"), "export default function() {}\n");
	const env: Record<string, string | undefined> = { ...process.env, PI_CONFIG_DIR: relative(homedir(), config) };
	for (const key of ["PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
		delete env[key];
	const invoke = async (args: string[]) => {
		const child = Bun.spawn([process.execPath, ...args], {
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
	const run = (...args: string[]) => invoke([cli, "plugin", ...args, "--json"]);
	const discover = () =>
		invoke([
			"-e",
			`import { getEnabledPlugins, getAllPluginCommandPaths, getAllPluginExtensionPaths } from ${JSON.stringify(loader)}; console.log(JSON.stringify({ plugins: await getEnabledPlugins(process.cwd()), commands: await getAllPluginCommandPaths(process.cwd()), extensions: await getAllPluginExtensionPaths(process.cwd()) }));`,
		]);
	return { root, config, project, plugin, metadata, run, discover };
}

describe("local linked plugin lifecycle", () => {
	for (const name of ["example-linked", "@example/linked"]) {
		it(`lists and discovers ${name} after the public link command`, async () => {
			const f = await fixture(name);
			expect((await f.run("link", f.plugin)).code).toBe(0);
			const result = await f.run("list");
			expect(result.code).toBe(0);
			const plugins = JSON.parse(result.stdout).npm;
			expect(plugins).toHaveLength(1);
			expect(plugins[0]).toMatchObject({ name, version: "1.0.0", enabled: true, enabledFeatures: null });
			expect(await readlink(plugins[0].path)).toBe(f.plugin);
			const discovery = await f.discover();
			expect(discovery.code).toBe(0);
			const loaded = JSON.parse(discovery.stdout);
			expect(loaded.plugins.map((p: { name: string }) => p.name)).toEqual([name]);
			expect(loaded.commands).toEqual([join(plugins[0].path, "hello.md")]);
			expect(loaded.extensions).toEqual([join(plugins[0].path, "extension.ts")]);
			const doctor = await f.run("doctor", "--fix");
			expect(doctor.code).toBe(0);
			expect(JSON.parse(doctor.stdout).some((c: { name: string }) => c.name === `orphan:${name}`)).toBe(false);
			expect(JSON.parse((await f.run("list")).stdout).npm).toHaveLength(1);
		}, 30_000);
	}

	it("relinks once while preserving global state, settings, regular packages and project overrides", async () => {
		const f = await fixture();
		expect((await f.run("link", f.plugin)).code).toBe(0);
		const lock = join(f.config, "plugins/xcsh-plugins.lock.json");
		const state = JSON.parse(await readFile(lock, "utf8"));
		state.plugins[f.metadata.name].enabledFeatures = [];
		state.plugins[f.metadata.name].enabled = false;
		state.settings[f.metadata.name] = { region: "example-region" };
		await writeFile(lock, JSON.stringify(state));
		const regular = join(f.config, "plugins/node_modules/regular");
		await mkdir(regular, { recursive: true });
		await writeFile(join(regular, "package.json"), JSON.stringify({ name: "regular", version: "2.0.0" }));
		const registryPath = join(f.config, "plugins/package.json");
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		registry.dependencies.regular = "2.0.0";
		await writeFile(registryPath, JSON.stringify(registry));
		await mkdir(join(f.project, ".xcsh"));
		await writeFile(
			join(f.project, ".xcsh/plugin-overrides.json"),
			JSON.stringify({ features: { [f.metadata.name]: ["optional"] } }),
		);
		expect((await f.run("link", f.plugin)).code).toBe(0);
		const plugins = JSON.parse((await f.run("list")).stdout).npm;
		expect(plugins).toHaveLength(2);
		expect(plugins.find((p: { name: string }) => p.name === f.metadata.name)).toMatchObject({
			enabled: false,
			enabledFeatures: ["optional"],
		});
		expect(JSON.parse(await readFile(lock, "utf8")).settings).toEqual(state.settings);
		expect(JSON.parse((await f.discover()).stdout).plugins).toEqual([]);
		expect((await f.run("enable", f.metadata.name)).code).toBe(0);
		await writeFile(join(f.project, ".xcsh/plugin-overrides.json"), JSON.stringify({ disabled: [f.metadata.name] }));
		expect(
			JSON.parse((await f.run("list")).stdout).npm.find((p: { name: string }) => p.name === f.metadata.name).enabled,
		).toBe(false);
		expect(JSON.parse((await f.discover()).stdout).plugins).toEqual([]);
	}, 30_000);

	for (const metadata of [
		{ name: "../outside", version: "1.0.0" },
		{ name: "@example/linked", version: null },
		{ name: "@example/linked", version: "1.0.0", xcsh: "invalid" },
		{ name: "@example/linked", version: "1.0.0", xcsh: { extensions: "invalid" } },
	]) {
		it(`rejects invalid package metadata before changing a valid link: ${JSON.stringify(metadata)}`, async () => {
			const f = await fixture();
			expect((await f.run("link", f.plugin)).code).toBe(0);
			const lock = join(f.config, "plugins/xcsh-plugins.lock.json");
			const original = await readFile(lock, "utf8");
			const invalid = join(f.root, "invalid");
			await mkdir(invalid);
			await writeFile(join(invalid, "package.json"), JSON.stringify(metadata));
			expect((await f.run("link", invalid)).code).not.toBe(0);
			expect(await readFile(lock, "utf8")).toBe(original);
			expect(await readlink(join(f.config, "plugins/node_modules", f.metadata.name))).toBe(f.plugin);
		}, 30_000);
	}

	it("reports a removed linked package through doctor without fabricating a listed package", async () => {
		const f = await fixture();
		expect((await f.run("link", f.plugin)).code).toBe(0);
		await rm(f.plugin, { recursive: true });
		expect(JSON.parse((await f.run("list")).stdout).npm).toEqual([]);
		const doctor = await f.run("doctor");
		expect(doctor.code).toBe(1);
		expect(
			JSON.parse(doctor.stdout).some(
				(c: { name: string; status: string }) => c.name === `plugin:${f.metadata.name}` && c.status === "error",
			),
		).toBe(true);
	}, 30_000);

	for (const invalid of ["{", JSON.stringify({ name: "foreign", version: "1.0.0", xcsh: {} })]) {
		it(`rejects corrupted or foreign linked package discovery: ${invalid}`, async () => {
			const f = await fixture();
			expect((await f.run("link", f.plugin)).code).toBe(0);
			await writeFile(join(f.plugin, "package.json"), invalid);
			expect((await f.run("list")).code).not.toBe(0);
			expect((await f.discover()).code).not.toBe(0);
		}, 30_000);
	}

	it("does not replace malformed runtime configuration with successful defaults", async () => {
		const f = await fixture();
		expect((await f.run("link", f.plugin)).code).toBe(0);
		const lock = join(f.config, "plugins/xcsh-plugins.lock.json");
		await writeFile(lock, "{");
		expect((await f.run("link", f.plugin)).code).not.toBe(0);
		expect(await readFile(lock, "utf8")).toBe("{");
		expect((await f.run("list")).code).not.toBe(0);
	}, 30_000);

	it("returns preserved runtime selections when relinking", async () => {
		const f = await fixture();
		expect((await f.run("link", f.plugin)).code).toBe(0);
		const lock = join(f.config, "plugins/xcsh-plugins.lock.json");
		const state = JSON.parse(await readFile(lock, "utf8"));
		state.plugins[f.metadata.name].enabled = false;
		state.plugins[f.metadata.name].enabledFeatures = [];
		await writeFile(lock, JSON.stringify(state));
		const relink = await f.run("link", f.plugin);
		expect(relink.code).toBe(0);
		expect(JSON.parse(relink.stdout)).toMatchObject({ enabled: false, enabledFeatures: [] });
	}, 30_000);

	for (const content of [
		{ plugins: {}, settings: [] },
		{ plugins: { "@example/linked": { enabled: "yes" } }, settings: {} },
	]) {
		it("rejects structurally invalid runtime state before changing a link", async () => {
			const f = await fixture();
			expect((await f.run("link", f.plugin)).code).toBe(0);
			const lock = join(f.config, "plugins/xcsh-plugins.lock.json");
			await writeFile(lock, JSON.stringify(content));
			const other = join(f.root, "other");
			await mkdir(other);
			await writeFile(join(other, "package.json"), JSON.stringify(f.metadata));
			expect((await f.run("link", other)).code).not.toBe(0);
			expect(await readlink(join(f.config, "plugins/node_modules", f.metadata.name))).toBe(f.plugin);
			expect(await readFile(lock, "utf8")).toBe(JSON.stringify(content));
		}, 30_000);
	}

	for (const dependencies of [[], { "../foreign": "1.0.0" }]) {
		it("rejects malformed dependency registries before registration or discovery", async () => {
			const f = await fixture();
			expect((await f.run("link", f.plugin)).code).toBe(0);
			const registry = join(f.config, "plugins/package.json");
			await writeFile(registry, JSON.stringify({ dependencies }));
			expect((await f.run("link", f.plugin)).code).not.toBe(0);
			expect((await f.run("list")).code).not.toBe(0);
			expect((await f.discover()).code).not.toBe(0);
		}, 30_000);
	}

	for (const content of [
		"{",
		JSON.stringify({ disabled: "example" }),
		JSON.stringify({ features: { "@example/linked": "optional" } }),
	]) {
		it("fails visibly on malformed project overrides instead of enabling default discovery", async () => {
			const f = await fixture();
			expect((await f.run("link", f.plugin)).code).toBe(0);
			await mkdir(join(f.project, ".xcsh"));
			await writeFile(join(f.project, ".xcsh/plugin-overrides.json"), content);
			expect((await f.run("list")).code).not.toBe(0);
			expect((await f.discover()).code).not.toBe(0);
		}, 30_000);
	}

	it("lists a valid package whose name matches an inherited object property", async () => {
		const f = await fixture("constructor");
		expect((await f.run("link", f.plugin)).code).toBe(0);
		const listed = await f.run("list");
		expect(listed.code).toBe(0);
		expect(JSON.parse(listed.stdout).npm).toHaveLength(1);
		expect(JSON.parse(listed.stdout).npm[0]).toMatchObject({
			name: "constructor",
			enabled: true,
			enabledFeatures: null,
		});
	}, 30_000);

	it("rejects an enable request for an unregistered inherited name", async () => {
		const f = await fixture();
		await mkdir(join(f.config, "plugins"), { recursive: true });
		expect((await f.run("enable", "constructor")).code).not.toBe(0);
	}, 30_000);

	for (const xcsh of [
		{ features: { optional: { default: "false" } } },
		{ settings: { region: { type: "unknown" } } },
		{ settings: { region: { type: ["string"] } } },
	]) {
		it("rejects malformed feature defaults and settings schemas before linking", async () => {
			const f = await fixture();
			await writeFile(join(f.plugin, "package.json"), JSON.stringify({ ...f.metadata, xcsh }));
			expect((await f.run("link", f.plugin)).code).not.toBe(0);
		}, 30_000);
	}
});
