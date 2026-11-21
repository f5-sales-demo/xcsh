import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishWaves } from "../../../scripts/ci-release-publish";

test("actual publisher retains already-shipped canonical interactions and runs current prepack", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-current-publication-"));
	try {
		for (const pkg of publishWaves.flat()) {
			await mkdir(join(root, pkg.dir), { recursive: true });
			await writeFile(
				join(root, pkg.dir, "package.json"),
				JSON.stringify({ name: `fixture-${pkg.dir.replaceAll("/", "-")}`, version: "1.0.0", private: true }),
			);
		}
		const pkg = join(root, "packages/coding-agent");
		const shared = join(pkg, "src/shared-interactions");
		await cp(new URL("../src/shared-interactions", import.meta.url).pathname, shared, { recursive: true });
		await mkdir(join(pkg, "src/session"));
		const consumer = 'export { validInputResponse } from "../shared-interactions/contract";\n';
		await writeFile(join(pkg, "src/session/consumer.ts"), consumer);
		const originalManifest = await readFile(join(shared, "manifest.json"), "utf8");
		const packageJson = JSON.stringify({
			name: "@f5-sales-demo/xcsh",
			version: "1.0.0",
			scripts: { prepack: "bun prepack.ts" },
		});
		await writeFile(join(pkg, "package.json"), packageJson);
		await writeFile(
			join(pkg, "prepack.ts"),
			`import { prepareSharedInteractions } from ${JSON.stringify(new URL("../../../scripts/prepare-shared-interactions.ts", import.meta.url).pathname)};
await prepareSharedInteractions(${JSON.stringify(new URL("../../chat-ui/src/interactions", import.meta.url).pathname)}, ${JSON.stringify(shared)}, true);
await Bun.write("prepack-ran.json", JSON.stringify({canonicalSourcesVerified:true}));\n`,
		);
		const bin = join(root, "bin");
		await mkdir(bin);
		const accepted = join(root, "accepted.json");
		await writeFile(
			join(bin, "npm"),
			`#!${process.execPath}
const args=process.argv.slice(2);
const marker=${JSON.stringify(accepted)};
if(args[0]==="view") {
 if(await Bun.file(marker).exists()) { console.log(JSON.stringify("1.0.0")); process.exit(0); }
 process.exit(1);
}
if(args[0]!=="publish") throw Error("Unexpected npm operation");
const prepack=Bun.spawnSync([process.execPath,"run","prepack"],{cwd:process.cwd()});
if(prepack.exitCode!==0) { console.error(prepack.stderr.toString()); process.exit(prepack.exitCode); }
await Bun.write(marker,JSON.stringify({args,prepackVerified:true}));\n`,
			{ mode: 0o700 },
		);
		const result = Bun.spawnSync(
			[
				process.execPath,
				new URL("../../../scripts/ci-release-publish.ts", import.meta.url).pathname,
				"--tag",
				"backfill",
			],
			{
				cwd: root,
				env: { ...process.env, XCSH_RELEASE_SOURCE_ROOT: root, PATH: `${bin}:${process.env.PATH ?? ""}` },
			},
		);
		expect(result.exitCode, result.stderr.toString()).toBe(0);
		expect(await Bun.file(accepted).json()).toEqual({
			args: ["publish", "--access", "public", "--provenance", "--tag", "backfill"],
			prepackVerified: true,
		});
		expect(await Bun.file(join(pkg, "prepack-ran.json")).json()).toEqual({ canonicalSourcesVerified: true });
		expect(await readFile(join(shared, "manifest.json"), "utf8")).toBe(originalManifest);
		expect(await readFile(join(pkg, "src/session/consumer.ts"), "utf8")).toBe(consumer);
		expect(await readFile(join(pkg, "package.json"), "utf8")).toBe(packageJson);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
