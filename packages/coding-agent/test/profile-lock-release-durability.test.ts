import { afterEach, expect, spyOn, test } from "bun:test";
import { constants, mkdirSync, renameSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as native from "@f5-sales-demo/pi-natives";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await fs.mkdtemp(join(tmpdir(), "profile-durability-"));
	roots.push(root);
	const parent = join(root, "parent");
	await fs.mkdir(parent, { mode: 0o700 });
	const path = join(parent, "synthetic.json");
	const store = new PrivateProfileStore(
		path,
		() => ({ schemaVersion: 1, revision: 0, value: "original" }),
		() => {},
		() => {},
		"person",
		25,
	);
	return { root, parent, lock: `${path}.lock`, store };
}
async function watchParent(parent: string) {
	const original = fs.open;
	const handles: Array<Awaited<ReturnType<typeof fs.open>>> = [];
	const opening = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
		const handle = await original(path, flags, mode);
		if (String(path) === parent && typeof flags === "number" && flags & constants.O_DIRECTORY) handles.push(handle);
		return handle;
	});
	return { handles, opening };
}

test.skipIf(process.platform !== "linux")(
	"parent replacement during final sync is refused and restoration uses the original descriptor",
	async () => {
		const { root, parent, lock, store } = await fixture();
		const watched = await watchParent(parent);
		const lease = await store.acquireResetLease();
		const handle = watched.handles[0]!;
		expect(watched.handles).toHaveLength(1);
		const owner = await fs.readFile(join(lock, "owner.json"), "utf8");
		const originalParent = join(root, "original-parent");
		const sync = handle.sync.bind(handle);
		let injected = false;
		const syncing = spyOn(handle, "sync").mockImplementation(async () => {
			await sync();
			if (!injected) {
				injected = true;
				renameSync(parent, originalParent);
				mkdirSync(parent, { mode: 0o700 });
				mkdirSync(lock, { mode: 0o700 });
				writeFileSync(join(lock, "owner.json"), "synthetic-new-parent-owner", { mode: 0o600 });
			}
		});
		try {
			await expect(lease.release()).rejects.toThrow("ownership_mismatch");
			expect(injected).toBe(true);
			expect(await fs.readFile(join(lock, "owner.json"), "utf8")).toBe("synthetic-new-parent-owner");
			expect(await fs.readFile(join(originalParent, basename(lock), "owner.json"), "utf8")).toBe(owner);
			expect(handle.fd).toBe(-1);
		} finally {
			syncing.mockRestore();
			watched.opening.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"capture durability failure restores the complete original directory and never replays",
	async () => {
		const { parent, lock, store } = await fixture();
		const watched = await watchParent(parent);
		const lease = await store.acquireResetLease();
		const handle = watched.handles[0]!;
		const before = await fs.lstat(lock);
		const owner = await fs.readFile(join(lock, "owner.json"), "utf8");
		const sync = handle.sync.bind(handle);
		const failure = new Error("synthetic-capture-sync-failure");
		let calls = 0;
		const syncing = spyOn(handle, "sync").mockImplementation(async () => {
			calls++;
			if (calls === 1) throw failure;
			await sync();
		});
		try {
			const results = await Promise.allSettled([lease.release(), lease.release()]);
			expect(results.map(r => r.status)).toEqual(["rejected", "rejected"]);
			for (const r of results) if (r.status === "rejected") expect(r.reason).toBe(failure);
			await expect(lease.release()).rejects.toBe(failure);
			expect(calls).toBe(2);
			const after = await fs.lstat(lock);
			expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
			expect(await fs.readFile(join(lock, "owner.json"), "utf8")).toBe(owner);
			expect(handle.fd).toBe(-1);
		} finally {
			syncing.mockRestore();
			watched.opening.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"durability failure with an active contender retains both complete directories and both failures",
	async () => {
		const { parent, lock, store } = await fixture();
		const watched = await watchParent(parent);
		const lease = await store.acquireResetLease();
		const handle = watched.handles[0]!;
		const before = await fs.lstat(lock);
		const owner = await fs.readFile(join(lock, "owner.json"), "utf8");
		const failure = new Error("synthetic-durability-conflict");
		const syncing = spyOn(handle, "sync").mockImplementation(async () => {
			mkdirSync(lock, { mode: 0o700 });
			writeFileSync(join(lock, "owner.json"), "synthetic-contender", { mode: 0o600 });
			throw failure;
		});
		try {
			const error = await lease.release().then(
				() => undefined,
				e => e,
			);
			expect(error).toBeInstanceOf(AggregateError);
			expect(error.errors).toHaveLength(2);
			expect(error.errors[0]).toBe(failure);
			expect(await fs.readFile(join(lock, "owner.json"), "utf8")).toBe("synthetic-contender");
			const retained = (await fs.readdir(parent)).filter(p => p.endsWith(".release-directory"));
			expect(retained).toHaveLength(1);
			const path = join(parent, retained[0]!);
			const identity = await fs.lstat(path);
			expect([identity.dev, identity.ino]).toEqual([before.dev, before.ino]);
			expect(await fs.readFile(join(path, "owner.json"), "utf8")).toBe(owner);
			expect(handle.fd).toBe(-1);
		} finally {
			syncing.mockRestore();
			watched.opening.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"capture destination collision preserves original and foreign directories without replay",
	async () => {
		const { parent, lock, store } = await fixture();
		const lease = await store.acquireResetLease();
		const owner = await fs.readFile(join(lock, "owner.json"), "utf8");
		const id = JSON.parse(owner).leaseId;
		const target = join(parent, `.person-profile-lock-${id}.release-directory`);
		await fs.mkdir(target, { mode: 0o700 });
		await fs.writeFile(join(target, "evidence"), "synthetic-foreign", { mode: 0o600 });
		const before = await fs.lstat(lock);
		await expect(lease.release()).rejects.toThrow("ownership_mismatch");
		await expect(lease.release()).rejects.toThrow("ownership_mismatch");
		const after = await fs.lstat(lock);
		expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
		expect(await fs.readFile(join(lock, "owner.json"), "utf8")).toBe(owner);
		expect(await fs.readFile(join(target, "evidence"), "utf8")).toBe("synthetic-foreign");
	},
);

test.skipIf(process.platform !== "linux")(
	"descriptor closure failure retains capture failure and closes only once",
	async () => {
		const { parent, lock, store } = await fixture();
		const watched = await watchParent(parent);
		const lease = await store.acquireResetLease();
		const handle = watched.handles[0]!;
		const owner = await fs.readFile(join(lock, "owner.json"), "utf8");
		const captureFailure = new Error("synthetic-capture-failure");
		const closeFailure = new Error("synthetic-close-failure");
		const originalMove = native.renameExclusiveAt;
		const move = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, target) => {
			if (source === basename(lock)) throw captureFailure;
			return originalMove(fd, source, target);
		});
		const close = handle.close.bind(handle);
		let calls = 0;
		const closing = spyOn(handle, "close").mockImplementation(async () => {
			calls++;
			await close();
			throw closeFailure;
		});
		try {
			const failure = await lease.release().then(
				() => undefined,
				e => e,
			);
			expect(failure).toBeInstanceOf(AggregateError);
			expect(failure.errors).toEqual([captureFailure, closeFailure]);
			await expect(lease.release()).rejects.toBe(failure);
			expect(calls).toBe(1);
			expect(handle.fd).toBe(-1);
			expect(await fs.readFile(join(lock, "owner.json"), "utf8")).toBe(owner);
		} finally {
			move.mockRestore();
			closing.mockRestore();
			watched.opening.mockRestore();
		}
	},
);

test.skipIf(process.platform !== "linux")(
	"timed out publication closes its original parent descriptor without touching the busy owner",
	async () => {
		const { parent, lock, store } = await fixture();
		await fs.mkdir(lock, { mode: 0o700 });
		await fs.writeFile(join(lock, "owner.json"), "synthetic-busy-owner", { mode: 0o600 });
		const watched = await watchParent(parent);
		try {
			await expect(store.acquireResetLease()).rejects.toThrow("lock_busy");
			expect(watched.handles).toHaveLength(1);
			expect(watched.handles[0]!.fd).toBe(-1);
			expect(await fs.readFile(join(lock, "owner.json"), "utf8")).toBe("synthetic-busy-owner");
		} finally {
			watched.opening.mockRestore();
		}
	},
);
