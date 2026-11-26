import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "profile-recovery-binding-"));
	roots.push(root);
	const path = join(root, "synthetic.json");
	const store = new PrivateProfileStore(
		path,
		() => ({ schemaVersion: 1, revision: 0, value: "original" }),
		() => {},
		() => {},
		"person",
		25,
	);
	return { root, path, store, lock: `${path}.lock` };
}
async function identity(path: string) {
	const stats = await lstat(path, { bigint: true });
	return { device: String(stats.dev), inode: String(stats.ino), uid: Number(stats.uid) };
}
test.skipIf(process.platform !== "linux")(
	"Reset publication binds the original parent, directory and owner inode",
	async () => {
		const { root, lock, store } = await fixture();
		const lease = await store.acquireResetLease();
		try {
			const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
			expect(owner.recoveryBinding).toEqual({
				schemaVersion: 1,
				parent: await identity(root),
				directory: await identity(lock),
				owner: await identity(join(lock, "owner.json")),
			});
		} finally {
			await lease.release();
		}
	},
);
test.skipIf(process.platform !== "linux")(
	"Mutation publication retains original inode attribution after ordinary release",
	async () => {
		const { root, lock, store } = await fixture();
		let original: ReturnType<typeof JSON.parse>;
		await store.mutate(profile => {
			original = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
			profile.value = "updated";
		});
		const names = (await readdir(root)).filter(name => name.endsWith(".release-directory"));
		expect(names).toHaveLength(1);
		const retained = join(root, names[0]!);
		expect(original!.recoveryBinding).toEqual({
			schemaVersion: 1,
			parent: await identity(root),
			directory: await identity(retained),
			owner: await identity(join(retained, "owner.json")),
		});
		expect(JSON.parse(await readFile(join(retained, "owner.json"), "utf8"))).toEqual(original!);
	},
);
