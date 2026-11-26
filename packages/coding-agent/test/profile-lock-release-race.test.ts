import { afterEach, expect, spyOn, test } from "bun:test";
import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as native from "@f5-sales-demo/pi-natives";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => filesystem.rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const directory = await filesystem.mkdtemp(join(tmpdir(), "profile-release-race-"));
	directories.push(directory);
	const path = join(directory, "synthetic.json");
	const store = new PrivateProfileStore(
		path,
		() => ({ schemaVersion: 1, revision: 0, value: "original" }),
		() => {},
		() => {},
		"person",
		25,
	);
	return { store, lock: `${path}.lock` };
}

test("replacement at the complete-directory capture boundary preserves foreign bytes and original evidence", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const owner = join(lock, "owner.json");
	const originalBytes = await filesystem.readFile(owner, "utf8");
	const originalStats = await filesystem.lstat(owner);
	const retained = `${lock}.original-owner`;
	const move = native.renameExclusiveAt;
	let injected = false;
	const replacement = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
		if (source === basename(lock) && !injected) {
			injected = true;
			renameSync(owner, retained);
			writeFileSync(owner, "synthetic-foreign-owner", { mode: 0o600 });
		}
		return move(fd, source, destination);
	});
	try {
		const outcome = await lease.release().then(
			() => ({ released: true }),
			error => ({ error }),
		);
		expect(injected).toBe(true);
		expect("error" in outcome).toBe(true);
		expect(await Bun.file(owner).exists()).toBe(true);
		expect(await filesystem.readFile(owner, "utf8")).toBe("synthetic-foreign-owner");
		expect(await filesystem.readFile(retained, "utf8")).toBe(originalBytes);
		const stats = await filesystem.lstat(retained);
		expect([stats.dev, stats.ino]).toEqual([originalStats.dev, originalStats.ino]);
	} finally {
		replacement.mockRestore();
	}
});

test("replacement at the complete-directory handoff boundary retains the empty historical replacement", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const retained = `${lock}.original-directory`;
	const move = native.renameExclusiveAt;
	let injected = false;
	let foreignInode: number | undefined;
	const replacement = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
		if (source === basename(lock) && !injected) {
			injected = true;
			renameSync(lock, retained);
			mkdirSync(lock, { mode: 0o700 });
			foreignInode = lstatSync(lock).ino;
		}
		return move(fd, source, destination);
	});
	try {
		const outcome = await lease.release().then(
			() => ({ released: true }),
			error => ({ error }),
		);
		expect(injected).toBe(true);
		expect("error" in outcome).toBe(true);
		expect(foreignInode).toBeDefined();
		expect((await filesystem.lstat(lock)).ino).toBe(foreignInode!);
		expect((await filesystem.lstat(retained)).isDirectory()).toBe(true);
	} finally {
		replacement.mockRestore();
	}
});
