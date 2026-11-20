import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("normal prepack refreshes current source and citation bytes before packing", async () => {
	const packageRoot = path.resolve(import.meta.dir, "../..");
	const production = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	const fixtureRoot = await mkdtemp(path.join(tmpdir(), "current-prepack-"));
	const fixture = path.join(fixtureRoot, "packages/coding-agent");
	await mkdir(fixture, { recursive: true });
	try {
		const rootScripts = path.join(fixtureRoot, "scripts");
		await mkdir(rootScripts);
		for (const name of ["prepare-qmd-attribution.ts", "prepare-shared-interactions.ts"]) {
			await copyFile(path.resolve(packageRoot, "../../scripts", name), path.join(rootScripts, name));
		}
		const sharedSource = path.join(fixtureRoot, "packages/chat-ui/src/interactions");
		await mkdir(sharedSource, { recursive: true });
		const canonicalSource = path.resolve(packageRoot, "../chat-ui/src/interactions");
		for (const name of await readdir(canonicalSource)) {
			if (name.endsWith(".ts")) await copyFile(path.join(canonicalSource, name), path.join(sharedSource, name));
		}
		await mkdir(path.join(fixture, "src/internal-urls"), { recursive: true });
		await mkdir(path.join(fixture, "node_modules/@tobilu/qmd"), { recursive: true });
		await writeFile(
			path.join(fixture, "node_modules/@tobilu/qmd/package.json"),
			JSON.stringify({
				name: "@tobilu/qmd",
				version: production.devDependencies["@tobilu/qmd"],
			}),
		);
		const output = path.join(fixture, "packages");
		await mkdir(output);
		await mkdir(path.join(fixture, "scripts"));
		await writeFile(path.join(fixture, "corpus-version.txt"), "archived");
		await writeFile(path.join(fixture, "citation-version.txt"), "archived");
		await writeFile(path.join(fixture, "upstream-version.txt"), "current");
		for (const match of production.scripts.prepack.matchAll(/bun\s+scripts\/([A-Za-z0-9_.-]+\.ts)/g)) {
			await writeFile(path.join(fixture, "scripts", match[1]), "export {};\n");
		}
		await writeFile(
			path.join(fixture, "scripts/prepare-verified-corpora.ts"),
			'const current = await Bun.file("upstream-version.txt").text();\n' +
				'await Bun.write("corpus-version.txt", current);\n' +
				'await Bun.write("citation-version.txt", current);\n',
		);
		await writeFile(
			path.join(fixture, "package.json"),
			JSON.stringify({
				name: "current-prepack-fixture",
				version: "0.0.0",
				files: ["corpus-version.txt", "citation-version.txt"],
				scripts: { prepack: production.scripts.prepack },
				devDependencies: { "@tobilu/qmd": production.devDependencies["@tobilu/qmd"] },
			}),
		);
		const child = Bun.spawn([process.execPath, "pm", "pack", "--quiet", "--destination", output], {
			cwd: fixture,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
		expect(code, stderr).toBe(0);
		const archives = (await readdir(output)).filter(name => name.endsWith(".tgz"));
		expect(archives).toHaveLength(1);
		for (const file of ["corpus-version.txt", "citation-version.txt"]) {
			const extract = Bun.spawn(["tar", "-xOf", path.join(output, archives[0]), `package/${file}`], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const [bytes, code] = await Promise.all([new Response(extract.stdout).text(), extract.exited]);
			expect(code).toBe(0);
			expect(bytes).toBe("current");
		}
	} finally {
		await rm(fixtureRoot, { recursive: true });
	}
}, 30_000);
