import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

test("SDK Bun file imports retain precise string-path types", async () => {
	const temp = await mkdtemp(join(tmpdir(), "xcsh-sdk-file-types-"));
	try {
		await writeFile(join(temp, "fixture.sqlite.gz"), "synthetic gzip type fixture");
		await writeFile(join(temp, "fixture.wasm"), "synthetic wasm type fixture");
		await writeFile(
			join(temp, "consumer.ts"),
			'import dbPath from "./fixture.sqlite.gz" with { type: "file" };\n' +
				'import wasmPath from "./fixture.wasm" with { type: "file" };\n' +
				"const paths: string[] = [dbPath, wasmPath];\nexport { paths };\n" +
				"// @ts-expect-error Bun file paths cannot be assigned to numbers.\nconst numericDb: number = dbPath;\n" +
				"// @ts-expect-error Bun file paths cannot be assigned to numbers.\nconst numericWasm: number = wasmPath;\n",
		);
		const tool = Bun.resolveSync("@typescript/native-preview/package.json", import.meta.dir);
		const manifest = JSON.parse(await readFile(tool, "utf8"));
		const child = Bun.spawn(
			[
				process.execPath,
				resolve(dirname(tool), manifest.bin.tsgo),
				"--ignoreConfig",
				"--noEmit",
				"--strict",
				"--skipLibCheck",
				"--target",
				"ES2024",
				"--module",
				"ESNext",
				"--moduleResolution",
				"Bundler",
				"--allowArbitraryExtensions",
				join(temp, "consumer.ts"),
				join(packageRoot, "src/bun-imports.d.ts"),
			],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [out, err, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(out + err).toBe("");
		expect(code).toBe(0);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}, 30_000);

test("packed SDK contains the exact original fixture imported by qmd smoke", async () => {
	const temp = await mkdtemp(join(tmpdir(), "xcsh-sdk-package-fixture-"));
	try {
		const archive = join(temp, "sdk.tgz");
		const pack = Bun.spawn(
			[process.execPath, "pm", "pack", "--ignore-scripts", "--quiet", "--gzip-level", "1", "--filename", archive],
			{ cwd: packageRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [out, err, code] = await Promise.all([
			new Response(pack.stdout).text(),
			new Response(pack.stderr).text(),
			pack.exited,
		]);
		expect(code, out + err).toBe(0);
		const member = "package/bench/fixtures/documentation-oct7-retired.json";
		const extract = Bun.spawn(["tar", "-xOf", archive, member], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const [bytes, errors, extracted] = await Promise.all([
			new Response(extract.stdout).arrayBuffer(),
			new Response(extract.stderr).text(),
			extract.exited,
		]);
		expect(extracted, errors).toBe(0);
		expect(new Uint8Array(bytes)).toEqual(
			new Uint8Array(await readFile(join(packageRoot, "bench/fixtures/documentation-oct7-retired.json"))),
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}, 60_000);

test("public SDK consumers load Bun asset types without local declarations", async () => {
	const temp = await mkdtemp(join(tmpdir(), "xcsh-sdk-public-types-"));
	try {
		await writeFile(join(temp, "fixture.sqlite.gz"), "synthetic gzip type fixture");
		await writeFile(join(temp, "fixture.wasm"), "synthetic wasm type fixture");
		await writeFile(
			join(temp, "consumer.ts"),
			'import type { ExtensionFactory } from "@f5-sales-demo/xcsh";\n' +
				'import dbPath from "./fixture.sqlite.gz" with { type: "file" };\n' +
				'import wasmPath from "./fixture.wasm" with { type: "file" };\n' +
				"export type PublicSDK = Parameters<ExtensionFactory>[0];\n" +
				"export const paths: string[] = [dbPath, wasmPath];\n",
		);
		await writeFile(
			join(temp, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2024",
					module: "ESNext",
					lib: ["ES2024", "DOM.AsyncIterable"],
					moduleResolution: "Bundler",
					moduleDetection: "force",
					strict: true,
					skipLibCheck: true,
					allowArbitraryExtensions: true,
					verbatimModuleSyntax: true,
					resolveJsonModule: true,
					esModuleInterop: true,
					types: ["bun"],
					typeRoots: [resolve(packageRoot, "../../node_modules/@types")],
					paths: {
						"@f5-sales-demo/xcsh": [join(packageRoot, "src/index.ts")],
						"@f5-sales-demo/xcsh-f5-core": [resolve(packageRoot, "../f5-core/src/index.ts")],
					},
					noEmit: true,
				},
				files: [join(temp, "consumer.ts")],
			}),
		);
		const tool = Bun.resolveSync("@typescript/native-preview/package.json", import.meta.dir);
		const manifest = JSON.parse(await readFile(tool, "utf8"));
		const child = Bun.spawn(
			[process.execPath, resolve(dirname(tool), manifest.bin.tsgo), "-p", join(temp, "tsconfig.json")],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [out, err, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(out + err).toBe("");
		expect(code).toBe(0);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}, 60_000);
