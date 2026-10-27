import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunExecPath } from "../../src/bun-path";
import { cachePlugin, cachePluginSnapshot } from "../../src/extensibility/plugins/marketplace/cache";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
	const root = await fs.mkdtemp(join(tmpdir(), "plugin-runtime-deps-"));
	roots.push(root);
	const source = join(root, "source");
	await fs.mkdir(source);
	const dependency = join(source, "runtime-dep");
	await fs.mkdir(dependency);
	await fs.writeFile(
		join(dependency, "package.json"),
		JSON.stringify({ name: "uat-runtime-dep", version: "1.0.0", type: "module", exports: "./index.js" }),
	);
	await fs.writeFile(join(dependency, "index.js"), "export const marker = 'DECLARED_RUNTIME_DEPENDENCY';");
	for (const name of ["dev", "peer"]) {
		const directory = join(source, name);
		await fs.mkdir(directory);
		await fs.writeFile(
			join(directory, "package.json"),
			JSON.stringify({ name: "uat-" + name + "-dep", version: "1.0.0", exports: "./index.js" }),
		);
		await fs.writeFile(join(directory, "index.js"), "export const marker = '" + name + "';");
	}
	await fs.writeFile(
		join(source, "package.json"),
		JSON.stringify({
			name: "uat-plugin",
			version: "1.0.0",
			type: "module",
			dependencies: { "uat-runtime-dep": "file:./runtime-dep" },
			devDependencies: { "uat-dev-dep": "file:./dev" },
			peerDependencies: { "uat-peer-dep": "file:./peer" },
		}),
	);
	await fs.writeFile(join(source, "entry.js"), "import {marker} from 'uat-runtime-dep'; console.log(marker);");
	const process = Bun.spawn([bunExecPath, "install", "--lockfile-only", "--ignore-scripts"], {
		cwd: source,
		stdout: "pipe",
		stderr: "pipe",
	});
	await new Response(process.stdout).text();
	await new Response(process.stderr).text();
	expect(await process.exited).toBe(0);
	const cache = join(root, "cache");
	const isolated = join(root, "isolated");
	await fs.mkdir(isolated);
	return { root, source, cache, isolated };
}
async function runInstalled(path: string, cwd: string) {
	const child = Bun.spawn([bunExecPath, join(path, "entry.js")], { cwd, stdout: "pipe", stderr: "pipe" });
	const output = await new Response(child.stdout).text();
	const error = await new Response(child.stderr).text();
	return { code: await child.exited, output, error };
}
describe("installed plugin runtime dependencies", () => {
	it.each([cachePlugin, cachePluginSnapshot])(
		"loads mandatory dependencies outside the developer checkout",
		async cache => {
			const f = await fixture();
			const installed = await cache(f.source, f.cache, "uat-market", "uat-plugin", "1.0.0");
			const result = await runInstalled(installed, f.isolated);
			expect(result.error).toBe("");
			expect(result.code).toBe(0);
			expect(result.output.trim()).toBe("DECLARED_RUNTIME_DEPENDENCY");
			expect(
				await fs.access(join(installed, "node_modules/uat-dev-dep")).then(
					() => true,
					() => false,
				),
			).toBe(false);
			expect(
				await fs.access(join(installed, "node_modules/uat-peer-dep")).then(
					() => true,
					() => false,
				),
			).toBe(false);
			expect(
				await fs.access(join(f.source, "node_modules")).then(
					() => true,
					() => false,
				),
			).toBe(false);
		},
	);
	it("preserves an existing cache when frozen dependency preparation fails", async () => {
		const f = await fixture();
		const old = join(f.cache, "uat-market___uat-plugin___1.0.0");
		await fs.mkdir(old, { recursive: true });
		await fs.writeFile(join(old, "preserved"), "RUNNING_INSTALL");
		await fs.writeFile(join(f.source, "bun.lock"), "invalid frozen lockfile");
		await expect(cachePlugin(f.source, f.cache, "uat-market", "uat-plugin", "1.0.0")).rejects.toThrow(/dependenc/i);
		expect(await fs.readFile(join(old, "preserved"), "utf8")).toBe("RUNNING_INSTALL");
	});
});

it("reuses verified prepared snapshots and detects runtime dependency tampering", async () => {
	const f = await fixture();
	const installed = await cachePluginSnapshot(f.source, f.cache, "uat-market", "uat-plugin", "1.0.0");
	expect(await cachePluginSnapshot(f.source, f.cache, "uat-market", "uat-plugin", "1.0.0")).toBe(installed);
	await fs.writeFile(join(installed, "node_modules", "unexpected-runtime-file"), "tampered");
	await expect(cachePluginSnapshot(f.source, f.cache, "uat-market", "uat-plugin", "1.0.0")).rejects.toThrow(
		/integrity/,
	);
	expect(await fs.readFile(join(installed, "node_modules", "unexpected-runtime-file"), "utf8")).toBe("tampered");
});
