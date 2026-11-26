import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "exclusive-publication-synthetic-"));
	directories.push(parent);
	const source = join(parent, "prepared");
	const destination = join(parent, "active");
	await mkdir(source, { mode: 0o700 });
	await writeFile(join(source, "owner.json"), "synthetic-attributed-owner", { mode: 0o600 });
	return { parent, source, destination };
}
function primitive(): (source: string, destination: string) => boolean {
	const native = require("../native/index.js") as Record<string, unknown>;
	expect(typeof native.renameExclusive).toBe("function");
	return native.renameExclusive as (source: string, destination: string) => boolean;
}
test("exclusive publication atomically moves a complete original directory", async () => {
	const { source, destination } = await fixture();
	const original = await lstat(source);
	expect(primitive()(source, destination)).toBe(true);
	expect(await readFile(join(destination, "owner.json"), "utf8")).toBe("synthetic-attributed-owner");
	const published = await lstat(destination);
	expect([published.dev, published.ino]).toEqual([original.dev, original.ino]);
	await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
});
for (const kind of ["empty-directory", "attributed-directory", "file", "symlink"] as const) {
	test(`exclusive publication preserves an existing ${kind} and the original preparation`, async () => {
		const { parent, source, destination } = await fixture();
		if (kind === "file") await writeFile(destination, "synthetic-foreign-file");
		else if (kind === "symlink") await symlink(source, destination);
		else {
			await mkdir(destination, { mode: 0o700 });
			if (kind === "attributed-directory")
				await writeFile(join(destination, "owner.json"), "synthetic-foreign-owner");
		}
		const before = await lstat(destination);
		expect(primitive()(source, destination)).toBe(false);
		const after = await lstat(destination);
		expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
		expect(await readFile(join(source, "owner.json"), "utf8")).toBe("synthetic-attributed-owner");
		if (kind === "attributed-directory")
			expect(await readFile(join(destination, "owner.json"), "utf8")).toBe("synthetic-foreign-owner");
		expect(parent).toBeDefined();
	});
}
test("exclusive publication rejects invalid paths without a replacing fallback", async () => {
	const { source, destination } = await fixture();
	const renameExclusive = primitive();
	expect(() => renameExclusive(`${source}\0suffix`, destination)).toThrow();
	expect(() => renameExclusive(join(source, "missing"), destination)).toThrow();
	expect(await readFile(join(source, "owner.json"), "utf8")).toBe("synthetic-attributed-owner");
	await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
});
