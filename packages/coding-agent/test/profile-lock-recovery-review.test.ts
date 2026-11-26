import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { cp, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
type Review = import("../src/person-profile/lock-recovery").ProfileLockRecoveryReview;
type RecoveryCandidate = {
	reviewLockRecovery(): Promise<Review>;
	recoverLock(
		review: Review,
		approvedSha256: string,
		signal?: AbortSignal,
	): Promise<{ status: "retained"; retainedDirectoryPath: string; intentPath: string; receiptSha256: string }>;
};
async function fixture(closed = true) {
	const root = await mkdtemp(join(tmpdir(), "profile-recovery-review-"));
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
	await store.mutate(profile => {
		profile.value = "preserved";
	});
	let lease: Awaited<ReturnType<typeof store.acquireResetLease>> | undefined;
	if (closed) {
		const script = `const { PrivateProfileStore } = await import(process.env.PROFILE_TEST_MODULE); const store = new PrivateProfileStore(process.env.PROFILE_TEST_PATH, () => ({schemaVersion:1,revision:0}), () => {}, () => {}, "person", 25); await store.acquireResetLease(); process.exit(0);`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			env: {
				...process.env,
				PROFILE_TEST_MODULE: new URL("../src/person-profile/private-store.ts", import.meta.url).href,
				PROFILE_TEST_PATH: path,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
	} else {
		lease = await store.acquireResetLease();
	}
	const lock = `${path}.lock`;
	return {
		root,
		path,
		lock,
		store,
		lease,
		candidate: store as unknown as RecoveryCandidate,
		profile: await readFile(path, "utf8"),
		owner: await readFile(join(lock, "owner.json"), "utf8"),
	};
}
test.skipIf(process.platform !== "linux")(
	"Review observes original exited holder without moving lock or changing profile",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		expect(review).toMatchObject({
			schemaVersion: 1,
			path: f.path,
			closure: { kind: "pid-absent" },
			ownerSha256: createHash("sha256").update(f.owner).digest("hex"),
			binding: JSON.parse(f.owner).recoveryBinding,
		});
		expect(review.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
test.skipIf(process.platform !== "linux")(
	"Review refuses live original holder and retains complete ownership",
	async () => {
		const f = await fixture(false);
		try {
			await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_busy" });
			expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
		} finally {
			await f.lease!.release();
		}
	},
);
test.skipIf(process.platform !== "linux")("Copied ownership cannot qualify a replacement lock directory", async () => {
	const f = await fixture();
	await cp(f.lock, join(f.root, "replacement"), { recursive: true });
	await rm(f.lock, { recursive: true });
	await cp(join(f.root, "replacement"), f.lock, { recursive: true });
	await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_recovery_unavailable" });
	expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
});
for (const failure of ["legacy-unbound", "foreign-namespace", "foreign-machine"] as const) {
	test.skipIf(process.platform !== "linux")(`Review retains ambiguous ${failure} ownership`, async () => {
		const f = await fixture();
		const owner = JSON.parse(f.owner);
		if (failure === "legacy-unbound") delete owner.recoveryBinding;
		if (failure === "foreign-namespace") owner.originalProcess.namespaces.pid = "pid:[1]";
		if (failure === "foreign-machine") owner.originalProcess.machineIdSha256 = "0".repeat(64);
		const bytes = JSON.stringify(owner);
		await writeFile(join(f.lock, "owner.json"), bytes);
		await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_recovery_unavailable" });
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(bytes);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	});
}

for (const reason of ["zero-birth", "wrong-birth", "malformed-owner", "oversized-owner", "binding-v1"] as const) {
	test.skipIf(process.platform !== "linux")(`Review retains ${reason} evidence without reset`, async () => {
		const f = await fixture();
		const owner = JSON.parse(f.owner);
		if (reason === "zero-birth") owner.recoveryBinding.owner.birthtimeNs = "0";
		if (reason === "wrong-birth")
			owner.recoveryBinding.directory.birthtimeNs = String(BigInt(owner.recoveryBinding.directory.birthtimeNs) + 1n);
		if (reason === "binding-v1") owner.recoveryBinding.schemaVersion = 1;
		const bytes =
			reason === "malformed-owner" ? "{" : reason === "oversized-owner" ? "x".repeat(16385) : JSON.stringify(owner);
		await writeFile(join(f.lock, "owner.json"), bytes);
		await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_recovery_unavailable" });
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(bytes);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	});
}
test.skipIf(process.platform !== "linux")(
	"Shared filesystem mapping cannot establish local original-holder closure",
	async () => {
		const f = await fixture();
		const original = await filesystem.statfs(f.root, { bigint: true });
		const injection = spyOn(filesystem, "statfs").mockResolvedValueOnce({ ...original, type: 0x6969n } as never);
		try {
			await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
				reason: "shared_or_unqualified_filesystem",
			});
		} finally {
			injection.mockRestore();
		}
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
	},
);
test.skipIf(process.platform !== "linux")(
	"Unavailable original process evidence cannot be treated as absence",
	async () => {
		const f = await fixture();
		const pid = JSON.parse(f.owner).pid;
		const real = filesystem.readFile;
		const injection = spyOn(filesystem, "readFile").mockImplementation(
			async (path: Parameters<typeof filesystem.readFile>[0], options?: unknown) => {
				if (String(path) === `/proc/${pid}/stat`)
					throw Object.assign(new Error("synthetic denial"), { code: "EACCES" });
				return Reflect.apply(real, filesystem, [path, options]);
			},
		);
		try {
			await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
				reason: "original_process_evidence_unavailable",
			});
		} finally {
			injection.mockRestore();
		}
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
	},
);
test.skipIf(process.platform !== "linux")(
	"Owner changes during closure observation invalidate the entire review",
	async () => {
		const f = await fixture();
		const pid = JSON.parse(f.owner).pid;
		const changed = JSON.stringify({ ...JSON.parse(f.owner), createdAt: "2000-01-01T00:00:00.000Z" });
		const real = filesystem.readFile;
		const injection = spyOn(filesystem, "readFile").mockImplementation(
			async (path: Parameters<typeof filesystem.readFile>[0], options?: unknown) => {
				if (String(path) === `/proc/${pid}/stat`) {
					await writeFile(join(f.lock, "owner.json"), changed);
					throw Object.assign(new Error("synthetic original absence"), { code: "ENOENT" });
				}
				return Reflect.apply(real, filesystem, [path, options]);
			},
		);
		try {
			await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
				reason: "evidence_changed_during_review",
			});
		} finally {
			injection.mockRestore();
		}
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(changed);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);

test.skipIf(process.platform !== "linux")(
	"Approved capture retains exact original directory and owner and refuses a second submission",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		const directory = await lstat(f.lock, { bigint: true });
		const owner = await lstat(join(f.lock, "owner.json"), { bigint: true });
		const result = await f.candidate.recoverLock(review, review.sha256);
		expect(result.status).toBe("retained");
		const retainedDirectory = await lstat(result.retainedDirectoryPath, { bigint: true });
		const retainedOwner = await lstat(join(result.retainedDirectoryPath, "owner.json"), { bigint: true });
		expect([retainedDirectory.dev, retainedDirectory.ino, retainedDirectory.birthtimeNs]).toEqual([
			directory.dev,
			directory.ino,
			directory.birthtimeNs,
		]);
		expect([retainedOwner.dev, retainedOwner.ino, retainedOwner.birthtimeNs]).toEqual([
			owner.dev,
			owner.ino,
			owner.birthtimeNs,
		]);
		expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(f.owner);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
		const bytes = await readFile(result.intentPath, "utf8");
		expect(JSON.parse(bytes)).toMatchObject({ schemaVersion: 1, approvedReviewSha256: review.sha256 });
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(result.receiptSha256);
		await expect(lstat(f.lock)).rejects.toMatchObject({ code: "ENOENT" });
		const inventory = (await readdir(f.root)).sort();
		await expect(f.candidate.recoverLock(review, review.sha256)).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
		});
		expect((await readdir(f.root)).sort()).toEqual(inventory);
	},
);
test.skipIf(process.platform !== "linux")(
	"Wrong reviewed authorization cannot create receipts or move the original lock",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		const inventory = (await readdir(f.root)).sort();
		await expect(f.candidate.recoverLock(review, "0".repeat(64))).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
		});
		expect((await readdir(f.root)).sort()).toEqual(inventory);
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
	},
);
test.skipIf(process.platform !== "linux")("Stale reviewed ownership cannot authorize a later capture", async () => {
	const f = await fixture();
	const review = await f.candidate.reviewLockRecovery();
	const changed = JSON.stringify({ ...JSON.parse(f.owner), createdAt: "2000-01-01T00:00:00.000Z" });
	await writeFile(join(f.lock, "owner.json"), changed);
	await expect(f.candidate.recoverLock(review, review.sha256)).rejects.toMatchObject({
		code: "lock_recovery_unavailable",
	});
	expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(changed);
	expect(await readFile(f.path, "utf8")).toBe(f.profile);
});
test.skipIf(process.platform !== "linux")(
	"Two concurrent approved recoveries retain exactly one original directory",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		const outcomes = await Promise.allSettled([
			f.candidate.recoverLock(review, review.sha256),
			f.candidate.recoverLock(review, review.sha256),
		]);
		expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
		expect(outcomes.filter(o => o.status === "rejected")).toHaveLength(1);
		const captures = (await readdir(f.root)).filter(name => name.endsWith(".recovery-directory"));
		expect(captures).toHaveLength(1);
		expect(await readFile(join(f.root, captures[0]!, "owner.json"), "utf8")).toBe(f.owner);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
test.skipIf(process.platform !== "linux")(
	"Cancelled authorization retains original lock without creating a capture",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		const controller = new AbortController();
		controller.abort();
		const inventory = (await readdir(f.root)).sort();
		await expect(f.candidate.recoverLock(review, review.sha256, controller.signal)).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
		});
		expect((await readdir(f.root)).sort()).toEqual(inventory);
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
	},
);

test.skipIf(process.platform !== "linux")(
	"Expired approval cannot retain an intent or move original evidence",
	async () => {
		const f = await fixture();
		const current = await f.candidate.reviewLockRecovery();
		const expired = { ...current, observedAt: "2000-01-01T00:00:00.000Z" };
		const body = Object.fromEntries(Object.entries(expired).filter(([key]) => key !== "sha256"));
		expired.sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
		const inventory = (await readdir(f.root)).sort();
		await expect(f.candidate.recoverLock(expired, expired.sha256)).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
			reason: "review_expired_or_future",
		});
		expect((await readdir(f.root)).sort()).toEqual(inventory);
	},
);
test.skipIf(process.platform !== "linux")("Existing authorization evidence is never overwritten", async () => {
	const f = await fixture();
	const review = await f.candidate.reviewLockRecovery();
	const intent = join(f.root, `.person-profile-lock-recovery-${review.sha256}.intent.json`);
	await writeFile(intent, "synthetic previous authorization evidence", { mode: 0o600 });
	await expect(f.candidate.recoverLock(review, review.sha256)).rejects.toMatchObject({
		code: "lock_recovery_unavailable",
		reason: "review_intent_unavailable_or_already_used",
	});
	expect(await readFile(intent, "utf8")).toBe("synthetic previous authorization evidence");
	expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
});
test.skipIf(process.platform !== "linux")(
	"Interrupted durable intent retains lock and consumes that exact review",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		const controller = new AbortController();
		const real = filesystem.open;
		const restore: (() => void)[] = [];
		const injection = spyOn(filesystem, "open").mockImplementation(
			async (path: Parameters<typeof filesystem.open>[0], ...args: unknown[]) => {
				const handle: Awaited<ReturnType<typeof filesystem.open>> = await Reflect.apply(real, filesystem, [
					path,
					...args,
				]);
				if (String(path).endsWith(".intent.json")) {
					const sync = handle.sync.bind(handle);
					const patch = spyOn(handle, "sync").mockImplementation(async () => {
						await sync();
						controller.abort();
					});
					restore.push(() => patch.mockRestore());
				}
				return handle;
			},
		);
		try {
			await expect(f.candidate.recoverLock(review, review.sha256, controller.signal)).rejects.toMatchObject({
				code: "lock_recovery_unavailable",
				reason: "request_cancelled",
			});
		} finally {
			injection.mockRestore();
			for (const restoreOriginal of restore) restoreOriginal();
		}
		const intents = (await readdir(f.root)).filter(name => name.endsWith(".intent.json"));
		expect(intents).toHaveLength(1);
		expect(JSON.parse(await readFile(join(f.root, intents[0]!), "utf8"))).toMatchObject({
			approvedReviewSha256: review.sha256,
		});
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
		await expect(f.candidate.recoverLock(review, review.sha256)).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
			reason: "review_intent_unavailable_or_already_used",
		});
	},
);
for (const conflict of [false, true]) {
	test.skipIf(process.platform !== "linux")(
		`Failed capture sync ${conflict ? "retains both original and new contender" : "restores the complete original directory"}`,
		async () => {
			const f = await fixture();
			const review = await f.candidate.reviewLockRecovery();
			const real = filesystem.open;
			const parents = new Map<number, Awaited<ReturnType<typeof filesystem.open>>>();
			const restore: (() => void)[] = [];
			let contender: Awaited<ReturnType<typeof f.store.acquireResetLease>> | undefined;
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
						expect(parent).toBeDefined();
						const sync = parent.sync.bind(parent);
						let calls = 0;
						const patch = spyOn(parent, "sync").mockImplementation(async () => {
							calls++;
							if (calls === 2) {
								if (conflict) contender = await f.store.acquireResetLease();
								throw Object.assign(new Error("synthetic capture-sync failure"), { code: "EIO" });
							}
							await sync();
						});
						restore.push(() => patch.mockRestore());
					}
					return handle;
				},
			);
			let outcome: unknown;
			try {
				outcome = await f.candidate.recoverLock(review, review.sha256).catch(error => error);
			} finally {
				injection.mockRestore();
				for (const restoreOriginal of restore) restoreOriginal();
			}
			try {
				if (conflict) {
					expect(outcome).toBeInstanceOf(AggregateError);
					const captured = (await readdir(f.root)).filter(name => name.endsWith(".recovery-directory"));
					expect(captured).toHaveLength(1);
					expect(await readFile(join(f.root, captured[0]!, "owner.json"), "utf8")).toBe(f.owner);
					expect(JSON.parse(await readFile(join(f.lock, "owner.json"), "utf8")).leaseId).not.toBe(
						JSON.parse(f.owner).leaseId,
					);
				} else {
					expect(outcome).toMatchObject({ code: "lock_recovery_unavailable", cause: { code: "EIO" } });
					expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
					expect((await readdir(f.root)).filter(name => name.endsWith(".recovery-directory"))).toHaveLength(0);
				}
				expect(await readFile(f.path, "utf8")).toBe(f.profile);
			} finally {
				await contender?.release();
			}
		},
	);
}

test.skipIf(process.platform !== "linux")(
	"Two independent original consumers cannot submit one reviewed recovery twice",
	async () => {
		const f = await fixture();
		const review = await f.candidate.reviewLockRecovery();
		const script = `const { PrivateProfileStore } = await import(process.env.PROFILE_TEST_MODULE); const store = new PrivateProfileStore(process.env.PROFILE_TEST_PATH, () => ({schemaVersion:1,revision:0}), () => {}, () => {}, "person", 25); const review = JSON.parse(process.env.PROFILE_TEST_REVIEW); try { await store.recoverLock(review, review.sha256); console.log("retained"); process.exitCode = 0; } catch (error) { if (error.code !== "lock_recovery_unavailable") throw error; console.log("refused"); process.exitCode = 23; }`;
		const env = {
			...process.env,
			PROFILE_TEST_MODULE: new URL("../src/person-profile/private-store.ts", import.meta.url).href,
			PROFILE_TEST_PATH: f.path,
			PROFILE_TEST_REVIEW: JSON.stringify(review),
		};
		const children = [0, 1].map(() =>
			Bun.spawn([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "pipe" }),
		);
		const outcomes = await Promise.all(
			children.map(async child => ({
				code: await child.exited,
				stdout: await new Response(child.stdout).text(),
				stderr: await new Response(child.stderr).text(),
			})),
		);
		expect(outcomes.map(o => o.code).sort((a, b) => a - b)).toEqual([0, 23]);
		expect(outcomes.map(o => o.stdout.trim()).sort()).toEqual(["refused", "retained"]);
		expect(outcomes.every(o => o.stderr === "")).toBe(true);
		const captures = (await readdir(f.root)).filter(name => name.endsWith(".recovery-directory"));
		expect(captures).toHaveLength(1);
		expect(await readFile(join(f.root, captures[0]!, "owner.json"), "utf8")).toBe(f.owner);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
		await f.store.mutate(profile => {
			profile.value = "ordinary post-recovery mutation";
		});
		expect((await f.store.get()).value).toBe("ordinary post-recovery mutation");
	},
);
test.skipIf(process.platform !== "linux")(
	"PID reuse proves closure only when the original start identity differs",
	async () => {
		const f = await fixture();
		const original = JSON.parse(f.owner).originalProcess;
		const real = filesystem.readFile;
		const self = await real("/proc/self/stat", "utf8");
		const end = self.lastIndexOf(")") + 2;
		const fields = self.slice(end).trim().split(/\s+/);
		fields[19] = String(BigInt(original.startTicks) + 1n);
		const reused = self.slice(0, end).replace(/^\d+/, String(original.pid)) + fields.join(" ");
		const injection = spyOn(filesystem, "readFile").mockImplementation(
			async (path: Parameters<typeof filesystem.readFile>[0], options?: unknown) => {
				if (String(path) === `/proc/${original.pid}/stat`) return reused;
				return Reflect.apply(real, filesystem, [path, options]);
			},
		);
		try {
			expect((await f.candidate.reviewLockRecovery()).closure.kind).toBe("pid-reused");
			fields[19] = original.startTicks;
			const same = self.slice(0, end).replace(/^\d+/, String(original.pid)) + fields.join(" ");
			injection.mockImplementation(async (path: Parameters<typeof filesystem.readFile>[0], options?: unknown) => {
				if (String(path) === `/proc/${original.pid}/stat`) return same;
				return Reflect.apply(real, filesystem, [path, options]);
			});
			await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_busy" });
		} finally {
			injection.mockRestore();
		}
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
	},
);

test.skipIf(process.platform !== "linux")("Every owner verification uses a bounded original descriptor", async () => {
	const f = await fixture();
	const real = filesystem.readFile;
	let unboundedOwnerReads = 0;
	const injection = spyOn(filesystem, "readFile").mockImplementation(
		async (path: Parameters<typeof filesystem.readFile>[0], options?: unknown) => {
			if (String(path) === join(f.lock, "owner.json")) {
				unboundedOwnerReads++;
				throw new Error("unbounded owner reader unavailable");
			}
			return Reflect.apply(real, filesystem, [path, options]);
		},
	);
	let review: Review | undefined;
	try {
		review = await f.candidate.reviewLockRecovery();
	} finally {
		injection.mockRestore();
	}
	expect(review?.closure.kind).toBe("pid-absent");
	expect(unboundedOwnerReads).toBe(0);
	expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
});
test.skipIf(process.platform !== "linux")(
	"Owner growth during final descriptor capture is bounded and refused",
	async () => {
		const f = await fixture();
		const realOpen = filesystem.open;
		const realReadFile = filesystem.readFile;
		const restore: (() => void)[] = [];
		let ownerReads = 0;
		let unboundedOwnerReads = 0;
		const oversized = "x".repeat(16385);
		const unbounded = spyOn(filesystem, "readFile").mockImplementation(
			async (path: Parameters<typeof filesystem.readFile>[0], options?: unknown) => {
				if (String(path) === join(f.lock, "owner.json")) {
					unboundedOwnerReads++;
					await writeFile(join(f.lock, "owner.json"), oversized);
				}
				return Reflect.apply(realReadFile, filesystem, [path, options]);
			},
		);
		const injection = spyOn(filesystem, "open").mockImplementation(
			async (path: Parameters<typeof filesystem.open>[0], ...args: unknown[]) => {
				const handle: Awaited<ReturnType<typeof filesystem.open>> = await Reflect.apply(realOpen, filesystem, [
					path,
					...args,
				]);
				if (String(path) === join(f.lock, "owner.json")) {
					const read = handle.read.bind(handle);
					const patch = spyOn(handle, "read").mockImplementation(async (...readArgs: unknown[]) => {
						ownerReads++;
						if (ownerReads === 3) await writeFile(join(f.lock, "owner.json"), oversized);
						return Reflect.apply(read, handle, readArgs);
					});
					restore.push(() => patch.mockRestore());
				}
				return handle;
			},
		);
		try {
			await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_recovery_unavailable" });
		} finally {
			injection.mockRestore();
			unbounded.mockRestore();
			for (const restoreOriginal of restore) restoreOriginal();
		}
		expect(unboundedOwnerReads).toBe(0);
		expect(ownerReads).toBe(3);
		expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(oversized);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
test.skipIf(process.platform !== "linux")("Approval expiry during durable intent cannot move the lock", async () => {
	const f = await fixture();
	const review = await f.candidate.reviewLockRecovery();
	const real = filesystem.open;
	const now = Date.now();
	const clock = spyOn(Date, "now").mockReturnValue(now);
	const restore: (() => void)[] = [];
	const injection = spyOn(filesystem, "open").mockImplementation(
		async (path: Parameters<typeof filesystem.open>[0], ...args: unknown[]) => {
			const handle: Awaited<ReturnType<typeof filesystem.open>> = await Reflect.apply(real, filesystem, [
				path,
				...args,
			]);
			if (String(path).endsWith(".intent.json")) {
				const sync = handle.sync.bind(handle);
				const patch = spyOn(handle, "sync").mockImplementation(async () => {
					await sync();
					clock.mockReturnValue(now + 300001);
				});
				restore.push(() => patch.mockRestore());
			}
			return handle;
		},
	);
	try {
		await expect(f.candidate.recoverLock(review, review.sha256)).rejects.toMatchObject({
			code: "lock_recovery_unavailable",
			reason: "review_expired_or_future",
		});
	} finally {
		injection.mockRestore();
		clock.mockRestore();
		for (const restoreOriginal of restore) restoreOriginal();
	}
	expect(await readFile(join(f.lock, "owner.json"), "utf8")).toBe(f.owner);
	expect((await readdir(f.root)).filter(name => name.endsWith(".intent.json"))).toHaveLength(1);
	expect((await readdir(f.root)).filter(name => name.endsWith(".recovery-directory"))).toHaveLength(0);
});

for (const age of [300000, 300001]) {
	test.skipIf(process.platform !== "linux")(
		`Reviewed action honors the exact five-minute boundary at ${age}ms`,
		async () => {
			const f = await fixture();
			const review = await f.candidate.reviewLockRecovery();
			const clock = spyOn(Date, "now").mockReturnValue(Date.parse(review.observedAt) + age);
			try {
				if (age === 300000) expect((await f.candidate.recoverLock(review, review.sha256)).status).toBe("retained");
				else
					await expect(f.candidate.recoverLock(review, review.sha256)).rejects.toMatchObject({
						code: "lock_recovery_unavailable",
						reason: "review_expired_or_future",
					});
			} finally {
				clock.mockRestore();
			}
			expect((await readdir(f.root)).filter(name => name.endsWith(".intent.json"))).toHaveLength(
				age === 300000 ? 1 : 0,
			);
			expect((await readdir(f.root)).filter(name => name.endsWith(".recovery-directory"))).toHaveLength(
				age === 300000 ? 1 : 0,
			);
			expect(await readFile(f.path, "utf8")).toBe(f.profile);
		},
	);
}
test.skipIf(process.platform !== "linux")(
	"Invalid UTF-8 ownership is refused without replacing the original bytes",
	async () => {
		const f = await fixture();
		const ownerPath = join(f.lock, "owner.json");
		const bytes = Buffer.concat([
			Buffer.from(f.owner.slice(0, -1) + ',"synthetic":"'),
			Buffer.from([0xff]),
			Buffer.from('"}'),
		]);
		await writeFile(ownerPath, bytes);
		await expect(f.candidate.reviewLockRecovery()).rejects.toMatchObject({ code: "lock_recovery_unavailable" });
		expect(await readFile(ownerPath)).toEqual(bytes);
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
