import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generateTypeScript } from "../scripts/generate-terraform-index";

const repo = resolve(import.meta.dir, "../../..");

async function biome(args: string[], configRoot = repo) {
	const tool = Bun.resolveSync("@biomejs/biome/package.json", import.meta.dir);
	const manifest = JSON.parse(await readFile(tool, "utf8"));
	const child = Bun.spawn(
		[process.execPath, resolve(dirname(tool), manifest.bin.biome), ...args, "--config-path", configRoot],
		{ cwd: configRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { out, err, code };
}

// These checks wait for their formatter children to exit naturally, including slow failing diffs.
test("default lint fully checks the actual large generated navigation indexes", async () => {
	const files = [
		"packages/coding-agent/src/internal-urls/public-citation-destinations.generated.ts",
		"packages/coding-agent/src/internal-urls/terraform-index.generated.ts",
	];
	for (const file of files) expect(Bun.file(resolve(repo, file)).size).toBeGreaterThan(1024 * 1024);
	const { out, err, code } = await biome(["check", ...files, "--reporter=json"]);
	const result = JSON.parse(out);
	expect(code, err).toBe(0);
	expect(result.summary.unchanged).toBe(2);
	expect(result.summary.errors).toBe(0);
	expect(result.summary.warnings).toBe(0);
	expect(result.diagnostics).toEqual([]);
}, 0);

test("canonical Terraform generator emits fully lintable source after its supported format step", async () => {
	const temp = await mkdtemp(join(tmpdir(), "xcsh-generated-index-lint-"));
	await writeFile(join(temp, "biome.json"), await readFile(join(repo, "biome.json")));
	const directory = join(temp, "packages/coding-agent/src/internal-urls");
	await mkdir(directory, { recursive: true });
	try {
		const file = join(directory, "canonical.ts");
		await writeFile(
			file,
			generateTypeScript({ schema_version: 1, provider: "xcsh", pages: [] }, "v13.0.0", "a".repeat(40)),
		);
		const formatted = await biome(["format", "--write", file], temp);
		expect(formatted.code, formatted.err).toBe(0);
		const { out, err, code } = await biome(["check", file, "--reporter=json"], temp);
		const result = JSON.parse(out);
		expect(code, err + out).toBe(0);
		expect(result.diagnostics).toEqual([]);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}, 0);

test("citation generator renders lintable mappings without changing values", async () => {
	const temp = await mkdtemp(join(tmpdir(), "xcsh-generated-index-lint-"));
	await writeFile(join(temp, "biome.json"), await readFile(join(repo, "biome.json")));
	const directory = join(temp, "packages/coding-agent/src/internal-urls");
	await mkdir(directory, { recursive: true });
	try {
		const file = join(directory, "citations.ts");
		const sources = { general: { version: "v1", digest: "a".repeat(64) } };
		const mappings = {
			"docs/quoted": { title: 'Unicode λ and "quoted" text', url: "https://example.test/docs/quoted" },
			["long-key-".repeat(12)]: { title: "A long title ".repeat(15), url: "https://example.test/long" },
			δ: { title: "Unicode key", url: "https://example.test/unicode" },
		};
		Object.defineProperty(mappings, "__proto__", {
			value: { title: "Reserved dictionary key", url: "https://example.test/reserved" },
			enumerable: true,
		});
		const child = Bun.spawn(
			[
				"python3",
				"-c",
				"import json,sys; sys.path.insert(0,sys.argv[1]); from public_citation_render import render_public_citation_exports; value=json.loads(sys.argv[2]); print(render_public_citation_exports(value['sources'], [('GENERAL_PUBLIC_DOCUMENTS',value['mappings'])]), end='')",
				resolve(repo, "packages/coding-agent/scripts"),
				JSON.stringify({ sources, mappings }),
			],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [out, err, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code, err).toBe(0);
		await writeFile(file, out);
		const checked = await biome(["check", file, "--reporter=json"], temp);
		expect(checked.code, checked.err + checked.out).toBe(0);
		expect(JSON.parse(checked.out).diagnostics).toEqual([]);
		const actual = await import(file);
		expect(actual.PUBLIC_CITATION_SOURCES).toEqual(sources);
		expect(actual.GENERAL_PUBLIC_DOCUMENTS).toEqual(mappings);
		expect(Object.hasOwn(actual.GENERAL_PUBLIC_DOCUMENTS, "__proto__")).toBe(true);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}, 0);
