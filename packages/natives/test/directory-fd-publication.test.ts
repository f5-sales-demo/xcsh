import { afterEach, expect, test } from "bun:test";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "descriptor-publication-"));
	directories.push(root);
	const parent = join(root, "parent");
	await mkdir(parent, { mode: 0o700 });
	await mkdir(join(parent, "source"), { mode: 0o700 });
	await writeFile(join(parent, "source", "owner.json"), "synthetic-original", { mode: 0o600 });
	const handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	return { root, parent, handle };
}
function primitive(): (fd: number, source: string, destination: string) => boolean {
	const native = require("../native/index.js") as Record<string, unknown>;
	expect(typeof native.renameExclusiveAt).toBe("function");
	return native.renameExclusiveAt as (fd: number, source: string, destination: string) => boolean;
}

test.skipIf(process.platform !== "linux")(
	"descriptor publication retains the complete original directory inode",
	async () => {
		const { parent, handle } = await fixture();
		try {
			const before = await lstat(join(parent, "source"));
			expect(primitive()(handle.fd, "source", "retained")).toBe(true);
			const after = await lstat(join(parent, "retained"));
			expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
			expect(await readFile(join(parent, "retained", "owner.json"), "utf8")).toBe("synthetic-original");
			await expect(lstat(join(parent, "source"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await handle.close();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"descriptor publication never replaces an existing empty destination",
	async () => {
		const { parent, handle } = await fixture();
		try {
			await mkdir(join(parent, "retained"));
			const before = await lstat(join(parent, "retained"));
			expect(primitive()(handle.fd, "source", "retained")).toBe(false);
			expect((await lstat(join(parent, "retained"))).ino).toBe(before.ino);
			expect(await readFile(join(parent, "source", "owner.json"), "utf8")).toBe("synthetic-original");
		} finally {
			await handle.close();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"descriptor publication refuses traversal, absolute paths, NUL and empty names",
	async () => {
		const { parent, handle } = await fixture();
		try {
			const move = primitive();
			for (const invalid of ["", ".", "..", "../source", "a/source", join(parent, "source"), "source\0suffix"]) {
				expect(() => move(handle.fd, invalid, "retained")).toThrow();
				expect(() => move(handle.fd, "source", invalid)).toThrow();
			}
			expect(await readFile(join(parent, "source", "owner.json"), "utf8")).toBe("synthetic-original");
		} finally {
			await handle.close();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"descriptor publication rejects unknown and nondirectory descriptors",
	async () => {
		const { parent, handle } = await fixture();
		const file = await open(join(parent, "source", "owner.json"));
		try {
			const move = primitive();
			expect(() => move(-1, "source", "retained")).toThrow();
			expect(() => move(2147483647, "source", "retained")).toThrow();
			expect(() => move(file.fd, "source", "retained")).toThrow();
		} finally {
			await file.close();
			await handle.close();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"replacing the parent pathname cannot redirect the original directory descriptor",
	async () => {
		const { root, parent, handle } = await fixture();
		try {
			const originalParent = join(root, "original-parent");
			await rename(parent, originalParent);
			await mkdir(parent, { mode: 0o700 });
			await mkdir(join(parent, "source"), { mode: 0o700 });
			await writeFile(join(parent, "source", "foreign"), "synthetic-foreign");
			const foreign = await lstat(join(parent, "source"));
			expect(primitive()(handle.fd, "source", "retained")).toBe(true);
			expect(await readFile(join(originalParent, "retained", "owner.json"), "utf8")).toBe("synthetic-original");
			expect((await lstat(join(parent, "source"))).ino).toBe(foreign.ino);
			expect(await readFile(join(parent, "source", "foreign"), "utf8")).toBe("synthetic-foreign");
		} finally {
			await handle.close();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"descriptor rename preserves a symlink object without following its target",
	async () => {
		const { parent, handle } = await fixture();
		try {
			await symlink("source", join(parent, "alias"));
			expect(primitive()(handle.fd, "alias", "retained")).toBe(true);
			expect((await lstat(join(parent, "retained"))).isSymbolicLink()).toBe(true);
			expect(await readFile(join(parent, "source", "owner.json"), "utf8")).toBe("synthetic-original");
		} finally {
			await handle.close();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"descriptor publication rejects a missing source without creating a destination",
	async () => {
		const { parent, handle } = await fixture();
		try {
			const move = primitive();
			expect(() => move(handle.fd, "missing", "retained")).toThrow();
			await expect(lstat(join(parent, "retained"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await handle.close();
		}
	},
);

test.skipIf(process.platform === "linux")("unsupported descriptor rename refuses without a pathname fallback", () => {
	const move = primitive();
	expect(() => move(0, "source", "retained")).toThrow("unavailable");
});
