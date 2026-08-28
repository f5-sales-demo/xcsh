import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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
		const before = digest(root);
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
		});
		expect(digest(root)).toBe(before);
		expect(existsSync(join(root, ".xcsh/plugins/installed_plugins.json"))).toBe(false);
	});
});
