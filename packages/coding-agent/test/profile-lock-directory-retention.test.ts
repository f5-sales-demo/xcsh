import { afterEach, expect, spyOn, test } from "bun:test";
import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as native from "@f5-sales-demo/pi-natives";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => filesystem.rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const root = await filesystem.mkdtemp(join(tmpdir(), "profile-retention-"));
	roots.push(root);
	const parent = join(root, "parent");
	await filesystem.mkdir(parent, { mode: 0o700 });
	const path = join(parent, "synthetic.json");
	const store = new PrivateProfileStore(
		path,
		() => ({ schemaVersion: 1, revision: 0, value: "original" }),
		() => {},
		() => {},
		"person",
		25,
	);
	return { root, parent, store, lock: `${path}.lock` };
}

test.skipIf(process.platform !== "linux")(
	"successful release retains the complete original directory and owner identity",
	async () => {
		const { parent, store, lock } = await fixture();
		const lease = await store.acquireResetLease();
		const before = await filesystem.lstat(lock);
		const owner = await filesystem.readFile(join(lock, "owner.json"), "utf8");
		await lease.release();
		const retained = (await filesystem.readdir(parent)).filter(name => name.endsWith(".release-directory"));
		expect(retained).toHaveLength(1);
		const directory = join(parent, retained[0]!);
		const after = await filesystem.lstat(directory);
		expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
		expect(await filesystem.readFile(join(directory, "owner.json"), "utf8")).toBe(owner);
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	},
);

test.skipIf(process.platform !== "linux")(
	"release succeeds without destructive owner or active-directory removal",
	async () => {
		const { store, lock } = await fixture();
		const lease = await store.acquireResetLease();
		const unlink = filesystem.unlink;
		const rmdir = filesystem.rmdir;
		const ownerGuard = spyOn(filesystem, "unlink").mockImplementation(async path => {
			if (String(path) === join(lock, "owner.json")) throw new Error("synthetic-forbidden-owner-deletion");
			return unlink(path);
		});
		const directoryGuard = spyOn(filesystem, "rmdir").mockImplementation(async path => {
			if (String(path) === lock) throw new Error("synthetic-forbidden-directory-deletion");
			return rmdir(path);
		});
		try {
			await expect(lease.release()).resolves.toBeUndefined();
		} finally {
			ownerGuard.mockRestore();
			directoryGuard.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"failed capture retains one original failure and does not replay on concurrent release",
	async () => {
		const { store, lock } = await fixture();
		const lease = await store.acquireResetLease();
		const owner = await filesystem.readFile(join(lock, "owner.json"), "utf8");
		const move = native.renameExclusiveAt;
		let calls = 0;
		const failure = new Error("synthetic-capture-permission-denial");
		const capture = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
			if (source === basename(lock)) {
				calls++;
				throw failure;
			}
			return move(fd, source, destination);
		});
		try {
			const outcomes = await Promise.allSettled([lease.release(), lease.release()]);
			expect(outcomes.map(outcome => outcome.status)).toEqual(["rejected", "rejected"]);
			for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toBe(failure);
			await expect(lease.release()).rejects.toBe(failure);
			expect(calls).toBe(1);
			expect(await filesystem.readFile(join(lock, "owner.json"), "utf8")).toBe(owner);
		} finally {
			capture.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"capture of a replaced directory restores foreign bytes and preserves original identity",
	async () => {
		const { store, lock } = await fixture();
		const lease = await store.acquireResetLease();
		const owner = await filesystem.readFile(join(lock, "owner.json"), "utf8");
		const original = `${lock}.original`;
		const move = native.renameExclusiveAt;
		let foreignInode: number | undefined;
		let injected = false;
		const capture = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
			if (source === basename(lock) && !injected) {
				injected = true;
				renameSync(lock, original);
				mkdirSync(lock, { mode: 0o700 });
				writeFileSync(join(lock, "owner.json"), "synthetic-foreign", { mode: 0o600 });
				foreignInode = lstatSync(lock).ino;
			}
			return move(fd, source, destination);
		});
		try {
			await expect(lease.release()).rejects.toThrow();
			expect(injected).toBe(true);
			expect(foreignInode).toBeDefined();
			expect((await filesystem.lstat(lock)).ino).toBe(foreignInode!);
			expect(await filesystem.readFile(join(lock, "owner.json"), "utf8")).toBe("synthetic-foreign");
			expect(await filesystem.readFile(join(original, "owner.json"), "utf8")).toBe(owner);
		} finally {
			capture.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"restoration conflict retains captured foreign directory and the new active contender",
	async () => {
		const { parent, store, lock } = await fixture();
		const lease = await store.acquireResetLease();
		const original = `${lock}.original`;
		const move = native.renameExclusiveAt;
		let capturedPath: string | undefined;
		let contenderInode: number | undefined;
		const capture = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
			if (source === basename(lock)) {
				renameSync(lock, original);
				mkdirSync(lock, { mode: 0o700 });
				writeFileSync(join(lock, "owner.json"), "synthetic-foreign", { mode: 0o600 });
				capturedPath = join(parent, destination);
				const moved = move(fd, source, destination);
				mkdirSync(lock, { mode: 0o700 });
				writeFileSync(join(lock, "owner.json"), "synthetic-new-contender", { mode: 0o600 });
				contenderInode = lstatSync(lock).ino;
				return moved;
			}
			return move(fd, source, destination);
		});
		try {
			const error = await lease.release().then(
				() => undefined,
				failure => failure,
			);
			expect(error).toBeInstanceOf(AggregateError);
			expect(error.errors).toHaveLength(2);
			expect(contenderInode).toBeDefined();
			expect((await filesystem.lstat(lock)).ino).toBe(contenderInode!);
			expect(await filesystem.readFile(join(lock, "owner.json"), "utf8")).toBe("synthetic-new-contender");
			expect(capturedPath).toBeDefined();
			expect(await filesystem.readFile(join(capturedPath!, "owner.json"), "utf8")).toBe("synthetic-foreign");
			expect((await filesystem.lstat(original)).isDirectory()).toBe(true);
		} finally {
			capture.mockRestore();
		}
	},
);
