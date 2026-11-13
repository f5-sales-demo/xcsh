import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.each(["qualified", "bare"])(
	"%s ordinary install preserves the required catalog scope and ambiguity",
	mode => {
		const root = mkdtempSync(join(tmpdir(), "xcsh-qualified-refresh-"));
		try {
			const repository = resolve(import.meta.dir, "../../../..");
			const cli = join(repository, "packages/coding-agent/src/cli.ts");
			const fixture = join(repository, "packages/coding-agent/test/marketplace/fixtures/valid-marketplace");
			const unrelated = join(root, "unrelated");
			cpSync(fixture, unrelated, { recursive: true });
			const catalogPath = join(unrelated, ".xcsh-plugin/marketplace.json");
			const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
			catalog.name = "unrelated-marketplace";
			writeFileSync(catalogPath, JSON.stringify(catalog));
			const env = { ...process.env, HOME: root };
			const invoke = (...args: string[]) => {
				const result = Bun.spawnSync(["bun", cli, "plugin", ...args], {
					cwd: root,
					env,
					stdout: "pipe",
					stderr: "pipe",
				});
				expect(result.exitCode).toBe(0);
				return result;
			};
			invoke("marketplace", "add", fixture);
			invoke("marketplace", "disable", "f5-sales-demo-marketplace");
			invoke("marketplace", "add", unrelated);
			const registryPath = join(root, ".xcsh/marketplaces.json");
			const before = JSON.parse(readFileSync(registryPath, "utf8")).marketplaces.find(
				(entry: { name: string }) => entry.name === "unrelated-marketplace",
			);
			expect(before.enabled).toBe(true);
			const cachedBefore = readFileSync(before.catalogPath, "utf8");
			catalog.plugins[0].description = "Changed upstream; an unrelated install must not refresh this catalog";
			writeFileSync(catalogPath, JSON.stringify(catalog));

			const installed = Bun.spawnSync(
				[
					"bun",
					cli,
					"plugin",
					"install",
					mode === "qualified" ? "hello-plugin@test-marketplace" : "hello-plugin",
					"--json",
				],
				{ cwd: root, env, stdout: "pipe", stderr: "pipe" },
			);
			if (mode === "qualified") {
				expect(installed.exitCode).toBe(0);
				expect(JSON.parse(new TextDecoder().decode(installed.stdout)).installation.plugin).toBe("hello-plugin");
			} else {
				expect(installed.exitCode).toBe(1);
				expect(new TextDecoder().decode(installed.stderr)).toContain("published by multiple marketplaces");
			}
			const after = JSON.parse(readFileSync(registryPath, "utf8")).marketplaces.find(
				(entry: { name: string }) => entry.name === "unrelated-marketplace",
			);
			if (mode === "qualified") {
				expect(after).toEqual(before);
				expect(readFileSync(before.catalogPath, "utf8")).toBe(cachedBefore);
			} else {
				expect(after.updatedAt).not.toBe(before.updatedAt);
				expect(JSON.parse(readFileSync(before.catalogPath, "utf8")).plugins[0].description).toBe(
					catalog.plugins[0].description,
				);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	15_000,
);
