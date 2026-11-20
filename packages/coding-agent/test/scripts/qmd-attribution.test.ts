import { afterEach, expect, it } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareQmdAttribution } from "../../../../scripts/prepare-qmd-attribution";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("imports shipped QMD attribution without a development installation", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "qmd-attribution-"));
	roots.push(root);
	const source = path.resolve(import.meta.dir, "../../src/internal-urls");
	await copyFile(path.join(source, "qmd-version.ts"), path.join(root, "qmd-version.ts"));
	const generated = Bun.file(path.join(source, "qmd-attribution.generated.json"));
	if (await generated.exists()) await copyFile(generated.name!, path.join(root, "qmd-attribution.generated.json"));
	await writeFile(
		path.join(root, "smoke.ts"),
		'import { QMD_VERSION } from "./qmd-version"; console.log(QMD_VERSION);',
	);
	const child = Bun.spawn([process.execPath, path.join(root, "smoke.ts")], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exit] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
	expect(stdout.trim()).toBe(
		(await Bun.file(path.resolve(import.meta.dir, "../../package.json")).json()).devDependencies["@tobilu/qmd"],
	);
});

async function metadataFixture(metadata: Record<string, unknown> = { name: "@tobilu/qmd", version: "2.8.3" }) {
	const root = await mkdtemp(path.join(tmpdir(), "qmd-generator-"));
	roots.push(root);
	await mkdir(path.join(root, "node_modules/@tobilu/qmd"), { recursive: true });
	await mkdir(path.join(root, "src/internal-urls"), { recursive: true });
	await writeFile(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "@tobilu/qmd": "2.8.3" } }));
	await writeFile(path.join(root, "node_modules/@tobilu/qmd/package.json"), JSON.stringify(metadata));
	return root;
}
it("generates attribution from actual installed metadata and verifies exact bytes", async () => {
	const root = await metadataFixture();
	await prepareQmdAttribution(root);
	await prepareQmdAttribution(root, true);
});
it("rejects a different installed version", async () => {
	const root = await metadataFixture({ name: "@tobilu/qmd", version: "2.8.4" });
	await expect(prepareQmdAttribution(root)).rejects.toThrow("differs");
});
it("rejects malformed metadata and foreign generator identity", async () => {
	for (const metadata of [
		{ name: "foreign", version: "2.8.3" },
		{ name: "@tobilu/qmd", version: 283 },
		{ name: "@tobilu/qmd", version: "latest" },
	]) {
		await expect(prepareQmdAttribution(await metadataFixture(metadata))).rejects.toThrow("invalid");
	}
});
it("rejects changed installed generator metadata during freshness check", async () => {
	const root = await metadataFixture();
	await prepareQmdAttribution(root);
	await writeFile(
		path.join(root, "node_modules/@tobilu/qmd/package.json"),
		JSON.stringify({ name: "@tobilu/qmd", version: "2.8.3", changed: true }),
	);
	await expect(prepareQmdAttribution(root, true)).rejects.toThrow("differs");
});
it("rejects missing installed generator instead of claiming attribution", async () => {
	const root = await metadataFixture();
	await rm(path.join(root, "node_modules/@tobilu/qmd/package.json"));
	await expect(prepareQmdAttribution(root)).rejects.toThrow();
});
