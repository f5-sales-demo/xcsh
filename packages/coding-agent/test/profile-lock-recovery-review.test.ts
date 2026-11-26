import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
type Review = {
	schemaVersion: number;
	sha256: string;
	ownerSha256: string;
	path: string;
	closure: { kind: string };
	binding: unknown;
};
type RecoveryCandidate = { reviewLockRecovery(): Promise<Review> };
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
