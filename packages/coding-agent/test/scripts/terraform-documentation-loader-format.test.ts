import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

test("Terraform documentation writer emits canonical loader bytes with reviewed pin in a Bun-only PATH", async () => {
	const root = await mkdtemp(path.join(import.meta.dir, "terraform-loader-format-"));
	const output = path.join(root, "loader ; $(touch marker).ts");
	const bin = path.join(root, "bin");
	await mkdir(bin);
	const generator = path.resolve(import.meta.dir, "../../scripts/generate-terraform-documentation-index.ts");
	const pin = JSON.parse(
		await readFile(path.resolve(import.meta.dir, "../../../../tools/terraform-documentation-release.json"), "utf8"),
	);
	const harness = path.join(root, "write.ts");
	await writeFile(
		harness,
		`import { writeTerraformDocumentationLoader } from ${JSON.stringify(generator)};\nawait writeTerraformDocumentationLoader(${JSON.stringify(output)}, ${JSON.stringify(pin)});\n`,
	);
	try {
		const environment = { ...process.env, PATH: bin };
		const child = Bun.spawn([process.execPath, harness], {
			cwd: path.resolve(import.meta.dir, "../.."),
			env: environment,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
		await new Response(child.stdout).text();
		expect({ code, error }).toEqual({ code: 0, error: "" });
		const content = await readFile(output, "utf8");
		const check = Bun.spawn(
			[process.execPath, "x", "--no-install", "--bun", "biome", "format", "--stdin-file-path", output],
			{
				cwd: path.resolve(import.meta.dir, "../.."),
				env: environment,
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		check.stdin.write(content);
		check.stdin.end();
		const [checkCode, canonical, checkError] = await Promise.all([
			check.exited,
			new Response(check.stdout).text(),
			new Response(check.stderr).text(),
		]);
		expect({ checkCode, checkError }).toEqual({ checkCode: 0, checkError: "" });
		expect(content).toBe(canonical);
		expect(content).toContain(JSON.stringify(pin.provider_version));
		expect(content).toContain(JSON.stringify(pin.receipt_sha256));
		expect(content).toContain(JSON.stringify(pin.index.gzip_sha256));
		expect(content).toContain("satisfies TerraformEmbeddedAssets");
		expect(
			await stat(path.join(root, "marker")).then(
				() => false,
				() => true,
			),
		).toBe(true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
