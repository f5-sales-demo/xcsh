import { afterEach, expect, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import { chmod, link, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
type Inspectable = {
	inspectLockRecovery(sha256: string): Promise<{
		status: string;
		intentUsed: boolean;
		completionConfirmed: boolean;
		activeLock: string;
		retainedDirectoryPath: string;
		receiptSha256: string;
	}>;
};
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "profile-recovery-inspection-"));
	roots.push(root);
	const path = join(root, "synthetic.json");
	const store = new PrivateProfileStore(
		path,
		() => ({ schemaVersion: 1, revision: 0, value: "synthetic" }),
		() => {},
		() => {},
		"person",
		25,
	);
	await store.mutate(profile => {
		profile.value = "preserved";
	});
	const module = new URL("../src/person-profile/private-store.ts", import.meta.url).href;
	const env = { ...process.env, PROFILE_TEST_MODULE: module, PROFILE_TEST_PATH: path };
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			'const { PrivateProfileStore } = await import(process.env.PROFILE_TEST_MODULE); const store = new PrivateProfileStore(process.env.PROFILE_TEST_PATH, () => ({schemaVersion:1,revision:0}), () => {}, () => {}, "person", 25); await store.acquireResetLease(); process.exit(0);',
		],
		{ env, stdout: "pipe", stderr: "pipe" },
	);
	expect({ code: await child.exited, stderr: await new Response(child.stderr).text() }).toEqual({
		code: 0,
		stderr: "",
	});
	const review = await store.reviewLockRecovery();
	return {
		root,
		path,
		store,
		review,
		env: { ...env, PROFILE_TEST_REVIEW: JSON.stringify(review) },
		candidate: store as unknown as Inspectable,
		owner: await readFile(join(`${path}.lock`, "owner.json"), "utf8"),
		profile: await readFile(path, "utf8"),
	};
}
for (const phase of ["intent", "capture"]) {
	test.skipIf(process.platform !== "linux")(
		`Read-only reconciliation observes a child exited after ${phase} without replay`,
		async () => {
			const f = await fixture();
			const script =
				'const { spyOn } = await import("bun:test"); const fs = await import("node:fs/promises"); const real = fs.open; spyOn(fs, "open").mockImplementation(async (path, ...args) => { if (process.env.PROFILE_TEST_PHASE === "capture" && String(path).endsWith(".recovery-directory")) process.exit(23); const handle = await real(path, ...args); if (process.env.PROFILE_TEST_PHASE === "intent" && String(path).endsWith(".intent.json")) { const sync = handle.sync.bind(handle); spyOn(handle, "sync").mockImplementation(async () => { await sync(); process.exit(23); }); } return handle; }); const { PrivateProfileStore } = await import(process.env.PROFILE_TEST_MODULE); const store = new PrivateProfileStore(process.env.PROFILE_TEST_PATH, () => ({schemaVersion:1,revision:0}), () => {}, () => {}, "person", 25); const review = JSON.parse(process.env.PROFILE_TEST_REVIEW); await store.recoverLock(review, review.sha256);';
			const child = Bun.spawn([process.execPath, "-e", script], {
				env: { ...f.env, PROFILE_TEST_PHASE: phase },
				stdout: "pipe",
				stderr: "pipe",
			});
			expect({ code: await child.exited, stderr: await new Response(child.stderr).text() }).toEqual({
				code: 23,
				stderr: "",
			});
			const names = (await readdir(f.root)).sort();
			const inspections = await Promise.all([
				f.candidate.inspectLockRecovery(f.review.sha256),
				f.candidate.inspectLockRecovery(f.review.sha256),
			]);
			for (const inspection of inspections)
				expect(inspection).toMatchObject({
					status: phase === "intent" ? "original-retained" : "captured",
					intentUsed: true,
					completionConfirmed: false,
					activeLock: phase === "intent" ? "original" : "absent",
				});
			expect(inspections[0]).toEqual(inspections[1]);
			expect((await readdir(f.root)).sort()).toEqual(names);
			const originalPath = phase === "intent" ? `${f.path}.lock` : inspections[0]!.retainedDirectoryPath;
			expect(await readFile(join(originalPath, "owner.json"), "utf8")).toBe(f.owner);
			expect(await readFile(f.path, "utf8")).toBe(f.profile);
			await expect(f.store.recoverLock(f.review, f.review.sha256)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
			});
			expect((await readdir(f.root)).sort()).toEqual(names);
		},
	);
}
test.skipIf(process.platform !== "linux")(
	"Captured original and fresh contender remain independently preserved by inspection",
	async () => {
		const f = await fixture();
		const result = await f.store.recoverLock(f.review, f.review.sha256);
		const contender = await f.store.acquireResetLease();
		try {
			const owner = await readFile(join(`${f.path}.lock`, "owner.json"), "utf8");
			expect(await f.candidate.inspectLockRecovery(f.review.sha256)).toMatchObject({
				status: "captured",
				activeLock: "different",
				intentUsed: true,
				completionConfirmed: false,
			});
			expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(f.owner);
			expect(await readFile(join(`${f.path}.lock`, "owner.json"), "utf8")).toBe(owner);
		} finally {
			await contender.release();
		}
	},
);
test.skipIf(process.platform !== "linux")("Insecure intent is refused without rewriting evidence", async () => {
	const f = await fixture();
	const result = await f.store.recoverLock(f.review, f.review.sha256);
	const bytes = await readFile(result.intentPath);
	await chmod(result.intentPath, 0o644);
	await expect(f.candidate.inspectLockRecovery(f.review.sha256)).rejects.toMatchObject({
		code: "lock_recovery_unavailable",
	});
	expect(await readFile(result.intentPath)).toEqual(bytes);
	expect(await readFile(f.path, "utf8")).toBe(f.profile);
});
test.skipIf(process.platform !== "linux")(
	"Foreign review digest cannot select or replay an original capture",
	async () => {
		const f = await fixture();
		await f.store.recoverLock(f.review, f.review.sha256);
		const names = (await readdir(f.root)).sort();
		await expect(f.candidate.inspectLockRecovery("0".repeat(64))).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
		});
		expect((await readdir(f.root)).sort()).toEqual(names);
	},
);

for (const failure of ["malformed", "oversized", "foreign-review"] as const) {
	test.skipIf(process.platform !== "linux")(
		`Inspection retains ${failure} intent without changing captured ownership`,
		async () => {
			const f = await fixture();
			const result = await f.store.recoverLock(f.review, f.review.sha256);
			const intent = JSON.parse(await readFile(result.intentPath, "utf8"));
			intent.review.path = join(f.root, "foreign.json");
			const bytes =
				failure === "malformed" ? "{" : failure === "oversized" ? "x".repeat(65537) : JSON.stringify(intent);
			await writeFile(result.intentPath, bytes);
			await expect(f.candidate.inspectLockRecovery(f.review.sha256)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
			});
			expect(await readFile(result.intentPath, "utf8")).toBe(bytes);
			expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(f.owner);
			expect(await readFile(f.path, "utf8")).toBe(f.profile);
		},
	);
}
test.skipIf(process.platform !== "linux")(
	"Intent change during contender observation invalidates reconciliation",
	async () => {
		const f = await fixture();
		const result = await f.store.recoverLock(f.review, f.review.sha256);
		const real = filesystem.lstat;
		let injected = false;
		const injection = spyOn(filesystem, "lstat").mockImplementation(
			async (path: Parameters<typeof filesystem.lstat>[0], ...args: unknown[]) => {
				if (String(path) === `${f.path}.lock`) {
					injected = true;
					await writeFile(result.intentPath, "{");
				}
				return Reflect.apply(real, filesystem, [path, ...args]);
			},
		);
		try {
			await expect(f.candidate.inspectLockRecovery(f.review.sha256)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
			});
		} finally {
			injection.mockRestore();
		}
		expect(injected).toBe(true);
		expect(await readFile(result.intentPath, "utf8")).toBe("{");
		expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(f.owner);
	},
);

for (const failure of ["symlink", "hardlink", "invalid-utf8"] as const) {
	test.skipIf(process.platform !== "linux")(
		`Inspection refuses ${failure} intent and preserves original capture`,
		async () => {
			const f = await fixture();
			const result = await f.store.recoverLock(f.review, f.review.sha256);
			if (failure === "symlink") {
				const retainedIntent = join(f.root, "original-intent.json");
				await rename(result.intentPath, retainedIntent);
				await symlink(retainedIntent, result.intentPath);
			}
			if (failure === "hardlink") await link(result.intentPath, join(f.root, "another-intent-name.json"));
			if (failure === "invalid-utf8") await writeFile(result.intentPath, Buffer.from([0xff]));
			const bytes = await readFile(result.intentPath);
			const names = (await readdir(f.root)).sort();
			await expect(f.candidate.inspectLockRecovery(f.review.sha256)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
			});
			expect(await readFile(result.intentPath)).toEqual(bytes);
			expect((await readdir(f.root)).sort()).toEqual(names);
			expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(f.owner);
		},
	);
}
test.skipIf(process.platform !== "linux")(
	"Captured owner change during contender observation invalidates reconciliation",
	async () => {
		const f = await fixture();
		const result = await f.store.recoverLock(f.review, f.review.sha256);
		const real = filesystem.lstat;
		const bytes = JSON.stringify({ ...JSON.parse(f.owner), createdAt: "2000-01-01T00:00:00.000Z" });
		const injection = spyOn(filesystem, "lstat").mockImplementation(
			async (path: Parameters<typeof filesystem.lstat>[0], ...args: unknown[]) => {
				if (String(path) === `${f.path}.lock`)
					await writeFile(join(result.retainedDirectoryPath, "owner.json"), bytes);
				return Reflect.apply(real, filesystem, [path, ...args]);
			},
		);
		try {
			await expect(f.candidate.inspectLockRecovery(f.review.sha256)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
			});
		} finally {
			injection.mockRestore();
		}
		expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(bytes);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
test.skipIf(process.platform !== "linux")(
	"Read-only inspection verifies complete original restoration after capture sync failure",
	async () => {
		const f = await fixture();
		const real = filesystem.open;
		const parents = new Map<number, Awaited<ReturnType<typeof filesystem.open>>>();
		const restore: (() => void)[] = [];
		const injection = spyOn(filesystem, "open").mockImplementation(
			async (path: Parameters<typeof filesystem.open>[0], ...args: unknown[]) => {
				const handle: Awaited<ReturnType<typeof filesystem.open>> = await Reflect.apply(real, filesystem, [
					path,
					...args,
				]);
				if (String(path) === f.root) parents.set(handle.fd, handle);
				if (String(path).endsWith(".intent.json")) {
					const fd = Number(String(path).match(/^\/proc\/self\/fd\/(\d+)\//)?.[1]);
					const parent = parents.get(fd)!;
					const sync = parent.sync.bind(parent);
					let calls = 0;
					const patch = spyOn(parent, "sync").mockImplementation(async () => {
						if (++calls === 2) throw Object.assign(new Error("synthetic capture sync failure"), { code: "EIO" });
						await sync();
					});
					restore.push(() => patch.mockRestore());
				}
				return handle;
			},
		);
		try {
			await expect(f.store.recoverLock(f.review, f.review.sha256)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
			});
		} finally {
			injection.mockRestore();
			for (const restoreOriginal of restore) restoreOriginal();
		}
		expect(await f.candidate.inspectLockRecovery(f.review.sha256)).toMatchObject({
			status: "original-retained",
			activeLock: "original",
			intentUsed: true,
			completionConfirmed: false,
		});
		expect(await readFile(join(`${f.path}.lock`, "owner.json"), "utf8")).toBe(f.owner);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
