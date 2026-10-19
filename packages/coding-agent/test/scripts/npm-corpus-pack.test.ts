import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("npm runtime corpus packaging", () => {
	it("ships the compressed runtime index without Terraform generation inputs", async () => {
		const packageRoot = path.resolve(import.meta.dir, "../..");
		const temporary = await mkdtemp(path.join(tmpdir(), "xcsh-npm-corpus-"));
		try {
			const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
			// Model the post-prepack tree without network-dependent corpus generation.
			delete manifest.scripts;
			delete manifest.dependencies;
			delete manifest.devDependencies;
			await writeFile(path.join(temporary, "package.json"), JSON.stringify(manifest));
			const corpus = "src/internal-urls/.documentation-generated/terraform/";
			const retained = [
				"bin/xcsh.ts",
				"src/index.ts",
				"src/internal-urls/terraform-documentation-assets.generated.ts",
				`${corpus}terraform-documentation.sqlite.gz`,
			];
			const excluded = [
				"terraform-documentation.sqlite",
				"manifest.json",
				"canonical-documentation.tar.gz",
				"registry-documentation.tar.gz",
				"future-generation-cache.bin",
			].map(name => corpus + name);
			for (const file of [...retained, ...excluded]) {
				await mkdir(path.dirname(path.join(temporary, file)), { recursive: true });
				await writeFile(path.join(temporary, file), "synthetic package fixture\n");
			}
			const ignore = path.join(packageRoot, "src/.npmignore");
			if (existsSync(ignore)) await cp(ignore, path.join(temporary, "src/.npmignore"));
			// npm is the publication packer; dependency installation remains Bun-only.
			const child = Bun.spawn(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
				cwd: temporary,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code, stderr).toBe(0);
			const files = JSON.parse(stdout)[0].files.map((file: { path: string }) => file.path);
			for (const file of retained) expect(files).toContain(file);
			for (const file of excluded) expect(files).not.toContain(file);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}, 30_000);
});
