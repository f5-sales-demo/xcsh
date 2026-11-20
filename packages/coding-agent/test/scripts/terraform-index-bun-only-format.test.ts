import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

async function formatInBunOnlyPath(source: string, filename: string) {
	const root = await mkdtemp(path.join(import.meta.dir, "terraform-index-bun-only-"));
	const output = path.join(root, filename);
	const bin = path.join(root, "bin");
	await mkdir(bin);
	const harness = path.join(root, "format.ts");
	const formatter = path.resolve(import.meta.dir, "../../scripts/generate-terraform-index.ts");
	await writeFile(output, source);
	await writeFile(
		harness,
		`import { formatTerraformIndex } from ${JSON.stringify(formatter)};\nawait formatTerraformIndex(${JSON.stringify(output)});\n`,
	);
	try {
		const child = Bun.spawn([process.execPath, harness], {
			cwd: path.resolve(import.meta.dir, "../.."),
			env: { ...process.env, PATH: bin },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return {
			code,
			stdout,
			stderr,
			content: await readFile(output, "utf8"),
			markerAbsent: await stat(path.join(root, "marker")).then(
				() => false,
				() => true,
			),
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("Terraform index formatting uses the running Bun without a bunx or node executable", async () => {
	const result = await formatInBunOnlyPath("export const value=1;\n", "current ; $(touch marker).ts");
	expect(result.code).toBe(0);
	expect(result.content).toBe("export const value = 1;\n");
	expect(result.markerAbsent).toBe(true);
});

test("actual formatter failures retain the file and parser diagnostics", async () => {
	const result = await formatInBunOnlyPath("export const value = ;\n", "broken.ts");
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("broken.ts");
	expect(result.stderr).toContain("parse");
});
