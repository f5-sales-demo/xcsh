import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareSharedInteractions, SHARED_MODULES } from "../../../../scripts/prepare-shared-interactions";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "sdk-shared-"));
	directories.push(root);
	const source = path.join(root, "source"),
		target = path.join(root, "target");
	await mkdir(source);
	for (const name of SHARED_MODULES) await writeFile(path.join(source, name + ".ts"), "export const value = 1;\n");
	return { source, target };
}
describe("packaged shared interaction assets", () => {
	it("prepares and verifies canonical bytes with a complete manifest", async () => {
		const { source, target } = await fixture();
		await prepareSharedInteractions(source, target);
		await prepareSharedInteractions(source, target, true);
		expect(Object.keys(JSON.parse(await readFile(path.join(target, "manifest.json"), "utf8")).files).length).toBe(7);
	});
	it("rejects a modified shipped module", async () => {
		const { source, target } = await fixture();
		await prepareSharedInteractions(source, target);
		await writeFile(path.join(target, "contract.ts"), "changed");
		await expect(prepareSharedInteractions(source, target, true)).rejects.toThrow("changed");
	});
	it("rejects missing shipped modules", async () => {
		const { source, target } = await fixture();
		await prepareSharedInteractions(source, target);
		await rm(path.join(target, "transport.ts"));
		await expect(prepareSharedInteractions(source, target, true)).rejects.toThrow("membership");
	});
	it("rejects dependencies outside the shipped closure", async () => {
		const { source, target } = await fixture();
		await writeFile(path.join(source, "contract.ts"), 'import {x} from "../private-file";\n');
		await expect(prepareSharedInteractions(source, target)).rejects.toThrow("unshipped");
	});
	it("rejects an extra file rather than deleting unrelated content", async () => {
		const { source, target } = await fixture();
		await mkdir(target);
		await writeFile(path.join(target, "foreign.ts"), "preserve");
		await expect(prepareSharedInteractions(source, target)).rejects.toThrow("Unregistered");
		expect(await readFile(path.join(target, "foreign.ts"), "utf8")).toBe("preserve");
	});
	it("rejects a changed manifest", async () => {
		const { source, target } = await fixture();
		await prepareSharedInteractions(source, target);
		await writeFile(path.join(target, "manifest.json"), "{}");
		await expect(prepareSharedInteractions(source, target, true)).rejects.toThrow("manifest");
	});
});

it("rejects unshipped side-effect imports", async () => {
	const { source, target } = await fixture();
	await writeFile(path.join(source, "contract.ts"), 'import "../private-file";\n');
	await expect(prepareSharedInteractions(source, target)).rejects.toThrow("unshipped");
});
it("rejects unshipped dynamic imports", async () => {
	const { source, target } = await fixture();
	await writeFile(path.join(source, "contract.ts"), 'export const load = () => import( "../private-file");\n');
	await expect(prepareSharedInteractions(source, target)).rejects.toThrow("unshipped");
});
