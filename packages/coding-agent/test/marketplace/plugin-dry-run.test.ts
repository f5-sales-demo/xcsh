import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function digest(root: string): string {
	const hash = createHash("sha256");
	function visit(path: string): void {
		if (!existsSync(path)) return;
		for (const name of readdirSync(path).sort()) {
			const child = join(path, name);
			const stat = statSync(child);
			hash.update(name);
			if (stat.isDirectory()) visit(child);
			else hash.update(readFileSync(child));
		}
	}
	visit(root);
	return hash.digest("hex");
}

describe("plugin install dry-run", () => {
	it("includes the dependency plan in a successful JSON install result", () => {
		const root = mkdtempSync(join(tmpdir(), "xcsh-plugin-result-plan-"));
		roots.push(root);
		const repository = resolve(import.meta.dir, "../../../..");
		const cli = join(repository, "packages/coding-agent/src/cli.ts");
		const fixture = join(repository, "packages/coding-agent/test/marketplace/fixtures/valid-marketplace");
		const environment = { ...process.env, HOME: root };
		expect(
			Bun.spawnSync(["bun", cli, "plugin", "marketplace", "add", fixture], { cwd: repository, env: environment })
				.exitCode,
		).toBe(0);
		const installed = Bun.spawnSync(["bun", cli, "plugin", "install", "hello-plugin@test-marketplace", "--json"], {
			cwd: repository,
			env: environment,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(installed.exitCode).toBe(0);
		expect(JSON.parse(new TextDecoder().decode(installed.stdout))).toMatchObject({
			installation: { plugin: "hello-plugin", marketplace: "test-marketplace", scope: "user" },
			dependencyPlan: [
				{
					pluginId: "hello-plugin@test-marketplace",
					version: "1.0.0",
					dependency: false,
				},
			],
		});
	});

	it("does not change marketplace plugin registry or cache", () => {
		const root = mkdtempSync(join(tmpdir(), "xcsh-plugin-dry-run-"));
		roots.push(root);
		const repository = resolve(import.meta.dir, "../../../..");
		const cli = join(repository, "packages/coding-agent/src/cli.ts");
		const fixture = join(repository, "packages/coding-agent/test/marketplace/fixtures/valid-marketplace");
		const environment = { ...process.env, HOME: root };
		const added = Bun.spawnSync(["bun", cli, "plugin", "marketplace", "add", fixture], {
			cwd: repository,
			env: environment,
		});
		expect(added.exitCode).toBe(0);
		const disabled = Bun.spawnSync(["bun", cli, "plugin", "marketplace", "disable", "f5-sales-demo-marketplace"], {
			cwd: repository,
			env: environment,
		});
		expect(disabled.exitCode).toBe(0);
		const before = digest(join(root, ".xcsh"));
		const preview = Bun.spawnSync(
			["bun", cli, "plugin", "install", "hello-plugin@test-marketplace", "--dry-run", "--json"],
			{ cwd: repository, env: environment, stdout: "pipe", stderr: "pipe" },
		);
		expect(preview.exitCode).toBe(0);
		expect(JSON.parse(new TextDecoder().decode(preview.stdout))).toEqual({
			action: "install",
			target: "hello-plugin@test-marketplace",
			scope: "user",
			dryRun: true,
			dependencyPlan: [
				{
					pluginId: "hello-plugin@test-marketplace",
					version: "1.0.0",
					scope: "user",
					dependency: false,
				},
			],
		});
		expect(digest(join(root, ".xcsh"))).toBe(before);
		expect(existsSync(join(root, ".xcsh/plugins/installed_plugins.json"))).toBe(false);
	});

	it("shows dependency order for upgrade previews without mutation", () => {
		const root = mkdtempSync(join(tmpdir(), "xcsh-plugin-upgrade-plan-"));
		roots.push(root);
		const repository = resolve(import.meta.dir, "../../../..");
		const cli = join(repository, "packages/coding-agent/src/cli.ts");
		const fixture = join(root, "marketplace");
		cpSync(join(repository, "packages/coding-agent/test/marketplace/fixtures/valid-marketplace"), fixture, {
			recursive: true,
		});
		const environment = { ...process.env, HOME: root };
		expect(
			Bun.spawnSync(["bun", cli, "plugin", "marketplace", "add", fixture], { cwd: repository, env: environment })
				.exitCode,
		).toBe(0);
		expect(
			Bun.spawnSync(["bun", cli, "plugin", "install", "hello-plugin@test-marketplace"], {
				cwd: repository,
				env: environment,
			}).exitCode,
		).toBe(0);
		const catalogPath = join(fixture, ".xcsh-plugin", "marketplace.json");
		const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
		catalog.plugins[0].version = "2.0.0";
		writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const before = digest(join(root, ".xcsh", "plugins"));
		const registryBefore = readFileSync(join(root, ".xcsh", "plugins", "installed_plugins.json"), "utf8");
		const preview = Bun.spawnSync(
			["bun", cli, "plugin", "upgrade", "hello-plugin@test-marketplace", "--dry-run", "--json"],
			{ cwd: repository, env: environment, stdout: "pipe", stderr: "pipe" },
		);
		expect(preview.exitCode).toBe(0);
		expect(JSON.parse(new TextDecoder().decode(preview.stdout))).toMatchObject({
			dryRun: true,
			updates: [
				{
					pluginId: "hello-plugin@test-marketplace",
					from: "1.0.0",
					to: "2.0.0",
					dependencyPlan: [
						{
							pluginId: "hello-plugin@test-marketplace",
							version: "2.0.0",
							dependency: false,
						},
					],
				},
			],
		});
		expect(digest(join(root, ".xcsh", "plugins"))).toBe(before);
		expect(readFileSync(join(root, ".xcsh", "plugins", "installed_plugins.json"), "utf8")).toBe(registryBefore);
	}, 15_000);
});
