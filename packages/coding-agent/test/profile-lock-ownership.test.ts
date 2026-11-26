import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as native from "@f5-sales-demo/pi-natives";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "profile-lock-owned-"));
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
	return { path, store, lock: `${path}.lock` };
}
test("a busy original lock retains its evidence and never recommends the same blocked reset", async () => {
	const { store, lock } = await fixture();
	await mkdir(lock, { mode: 0o700 });
	const owner = join(lock, "owner.json");
	await writeFile(owner, "", { mode: 0o600 });
	for (const invoke of [
		() =>
			store.mutate(profile => {
				profile.value = "changed";
			}),
		() => store.reset(),
	]) {
		const error = await invoke().then(
			() => undefined,
			error => error,
		);
		expect(error?.code).toBe("lock_busy");
		expect(error.message).not.toContain("profile reset");
		expect(error.message).toMatch(/retain.*owner|owner.*retain/i);
		expect(await readFile(owner, "utf8")).toBe("");
	}
});
test("reset publishes a versioned attributable owner before returning its lease", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	try {
		const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
		expect(owner).toMatchObject({ schemaVersion: 1, domain: "person", operation: "reset", pid: process.pid });
		expect(owner.leaseId).toMatch(/^[0-9a-f-]{36}$/);
	} finally {
		await lease.release();
	}
});
test("mutation publishes the same attributable owner before invoking the change", async () => {
	const { store, lock } = await fixture();
	await store.mutate(profile => {
		const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
		expect(owner).toMatchObject({ schemaVersion: 1, domain: "person", operation: "mutate", pid: process.pid });
		expect(owner.leaseId).toMatch(/^[0-9a-f-]{36}$/);
		profile.value = "changed";
	});
	expect((await store.get()).value).toBe("changed");
});
test("a reset lease refuses a replaced lock and retains both original and replacement evidence", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const retained = `${lock}.retained`;
	await rename(lock, retained);
	await mkdir(lock, { mode: 0o700 });
	const replacement = join(lock, "owner.json");
	await writeFile(replacement, "synthetic-replacement-owner", { mode: 0o600 });
	await expect(lease.release()).rejects.toThrow("ownership_mismatch");
	expect(await readFile(replacement, "utf8")).toBe("synthetic-replacement-owner");
	await expect((await import("node:fs/promises")).lstat(retained)).resolves.toBeDefined();
});

test("unexpected lock contents refuse release without deleting original owner evidence", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const ownerPath = join(lock, "owner.json");
	const originalOwner = await readFile(ownerPath, "utf8");
	await writeFile(join(lock, "unexpected-evidence"), "synthetic-retained", { mode: 0o600 });
	await expect(lease.release()).rejects.toThrow();
	expect(await readFile(ownerPath, "utf8")).toBe(originalOwner);
	expect(await readFile(join(lock, "unexpected-evidence"), "utf8")).toBe("synthetic-retained");
});
test("reset inspection refuses changed owner bytes and retains the original profile", async () => {
	const { store, lock, path } = await fixture();
	await store.mutate(profile => {
		profile.value = "before";
	});
	const originalProfile = await readFile(path, "utf8");
	const lease = await store.acquireResetLease();
	const ownerPath = join(lock, "owner.json");
	await writeFile(ownerPath, "synthetic-changed-owner", { mode: 0o600 });
	await expect(lease.inspect()).rejects.toThrow("ownership_mismatch");
	await expect(lease.remove()).rejects.toThrow("ownership_mismatch");
	await expect(lease.release()).rejects.toThrow("ownership_mismatch");
	expect(await readFile(path, "utf8")).toBe(originalProfile);
	expect(await readFile(ownerPath, "utf8")).toBe("synthetic-changed-owner");
});
test("Linux lease attribution binds the original kernel process start and boot", async () => {
	if (process.platform !== "linux") return;
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	try {
		const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
		const raw = await readFile("/proc/self/stat", "utf8");
		const start = raw
			.slice(raw.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/)[19];
		expect(owner.originalProcess).toMatchObject({
			platform: "linux",
			pid: process.pid,
			startTicks: start,
			bootId: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
		});
		expect(owner.originalProcess.machineIdSha256).toMatch(/^[a-f0-9]{64}$/);
	} finally {
		await lease.release();
	}
});
test("cancelled mutation retains profile content and releases only its original lease", async () => {
	const { store, lock, path } = await fixture();
	await store.mutate(profile => {
		profile.value = "before";
	});
	const original = await readFile(path, "utf8");
	const controller = new AbortController();
	await expect(
		store.mutate(
			profile => {
				profile.value = "cancelled";
				controller.abort();
			},
			undefined,
			controller.signal,
		),
	).rejects.toThrow("cancelled");
	expect(await readFile(path, "utf8")).toBe(original);
	await expect((await import("node:fs/promises")).lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
});

test("concurrent release callers observe one original lease closure without replay", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const results = await Promise.allSettled([lease.release(), lease.release()]);
	expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
	await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
});

test("failed directory release retains the original owner evidence for recovery", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const ownerPath = join(lock, "owner.json");
	const originalOwner = await readFile(ownerPath, "utf8");
	const originalRemove = native.renameExclusiveAt;
	let injected = false;
	const removal = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
		if (source === basename(lock)) {
			injected = true;
			throw new Error("synthetic-directory-release-failure");
		}
		return originalRemove(fd, source, destination);
	});
	try {
		await expect(lease.release()).rejects.toThrow("synthetic-directory-release-failure");
		expect(injected).toBe(true);
		expect(await readFile(ownerPath, "utf8")).toBe(originalOwner);
	} finally {
		removal.mockRestore();
	}
});

test("concurrent failed release callers retain one failure and never submit closure again", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const ownerPath = join(lock, "owner.json");
	const originalOwner = await readFile(ownerPath, "utf8");
	const originalRemove = native.renameExclusiveAt;
	let calls = 0;
	const removal = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
		if (source === basename(lock)) {
			calls++;
			throw new Error("synthetic-shared-release-failure");
		}
		return originalRemove(fd, source, destination);
	});
	try {
		const outcomes = await Promise.allSettled([lease.release(), lease.release(), lease.release()]);
		expect(outcomes.map(outcome => outcome.status)).toEqual(["rejected", "rejected", "rejected"]);
		const failures = outcomes.filter(outcome => outcome.status === "rejected");
		expect(failures[0]?.reason).toBe(failures[1]?.reason);
		expect(failures[1]?.reason).toBe(failures[2]?.reason);
		await expect(lease.release()).rejects.toBe(failures[0]?.reason);
		expect(calls).toBe(1);
		expect(await readFile(ownerPath, "utf8")).toBe(originalOwner);
	} finally {
		removal.mockRestore();
	}
});

test("replacement during failed release preserves foreign bytes and an original owner inode", async () => {
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	const ownerPath = join(lock, "owner.json");
	const originalOwner = await readFile(ownerPath, "utf8");
	const originalStats = await filesystem.lstat(ownerPath);
	const retainedDirectory = `${lock}.original-directory`;
	const originalRemove = native.renameExclusiveAt;
	const removal = spyOn(native, "renameExclusiveAt").mockImplementation((fd, source, destination) => {
		if (source === basename(lock)) {
			renameSync(lock, retainedDirectory);
			mkdirSync(lock, { mode: 0o700 });
			writeFileSync(ownerPath, "synthetic-foreign-owner", { mode: 0o600 });
			throw new Error("synthetic-replaced-directory-release-failure");
		}
		return originalRemove(fd, source, destination);
	});
	try {
		await expect(lease.release()).rejects.toThrow();
		expect(await readFile(ownerPath, "utf8")).toBe("synthetic-foreign-owner");
		const parent = (await import("node:path")).dirname(lock);
		const originalEvidence: string[] = [];
		for (const name of await filesystem.readdir(parent)) {
			const path = join(parent, name);
			const stats = await filesystem.lstat(path);
			if (stats.isDirectory()) {
				const owner = join(path, "owner.json");
				const identity = await filesystem.lstat(owner);
				if (identity.dev === originalStats.dev && identity.ino === originalStats.ino)
					originalEvidence.push(await readFile(owner, "utf8"));
			}
		}
		expect(originalEvidence).toEqual([originalOwner]);
	} finally {
		removal.mockRestore();
	}
});

test("Linux reset and mutation owners retain original PID, mount and user namespace identities", async () => {
	if (process.platform !== "linux") return;
	const namespaces = {
		pid: await filesystem.readlink("/proc/self/ns/pid"),
		mount: await filesystem.readlink("/proc/self/ns/mnt"),
		user: await filesystem.readlink("/proc/self/ns/user"),
	};
	const { store, lock } = await fixture();
	const lease = await store.acquireResetLease();
	try {
		const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
		expect(owner.originalProcess.namespaces).toEqual(namespaces);
	} finally {
		await lease.release();
	}
	await store.mutate(profile => {
		const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
		expect(owner.originalProcess.namespaces).toEqual(namespaces);
		profile.value = "changed";
	});
});

test("Unavailable Linux namespace identity refuses acquisition without changing the profile", async () => {
	if (process.platform !== "linux") return;
	const { store, path, lock } = await fixture();
	await store.mutate(profile => {
		profile.value = "before-namespace-refusal";
	});
	const original = await readFile(path, "utf8");
	const unavailable = spyOn(filesystem, "readlink").mockRejectedValue(new Error("synthetic unavailable namespace"));
	try {
		await expect(
			store.mutate(profile => {
				profile.value = "must-not-be-written";
			}),
		).rejects.toThrow("persistence_unavailable");
		expect(await readFile(path, "utf8")).toBe(original);
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		unavailable.mockRestore();
	}
});

for (const invalid of [0, 1, 2]) {
	test(`Malformed Linux namespace ${invalid} refuses mutation and preserves the profile`, async () => {
		if (process.platform !== "linux") return;
		const identities = await Promise.all(
			["pid", "mnt", "user"].map(name => filesystem.readlink(`/proc/self/ns/${name}`)),
		);
		const { store, path, lock } = await fixture();
		await store.mutate(profile => {
			profile.value = "before-malformed-namespace";
		});
		const original = await readFile(path, "utf8");
		const malformed = spyOn(filesystem, "readlink");
		for (let index = 0; index < identities.length; index++) {
			malformed.mockResolvedValueOnce(index === invalid ? "synthetic-invalid-namespace" : identities[index]!);
		}
		try {
			await expect(
				store.mutate(profile => {
					profile.value = "must-not-be-written";
				}),
			).rejects.toThrow("persistence_unavailable");
			expect(await readFile(path, "utf8")).toBe(original);
			await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			malformed.mockRestore();
		}
	});
}

test("Changed Linux namespace identity before publication refuses mutation and retains the profile", async () => {
	if (process.platform !== "linux") return;
	const identities = await Promise.all(
		["pid", "mnt", "user"].map(name => filesystem.readlink(`/proc/self/ns/${name}`)),
	);
	const { store, path, lock } = await fixture();
	await store.mutate(profile => {
		profile.value = "before-changed-namespace";
	});
	const original = await readFile(path, "utf8");
	const changed = spyOn(filesystem, "readlink");
	for (const identity of identities) changed.mockResolvedValueOnce(identity);
	changed.mockResolvedValueOnce(`pid:[${BigInt(identities[0]!.slice(5, -1)) + 1n}]`);
	changed.mockResolvedValueOnce(identities[1]!);
	changed.mockResolvedValueOnce(identities[2]!);
	try {
		await expect(
			store.mutate(profile => {
				profile.value = "must-not-be-written";
			}),
		).rejects.toThrow("ownership_mismatch");
		expect(await readFile(path, "utf8")).toBe(original);
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		changed.mockRestore();
	}
});

for (const unqualifiedPlatform of ["darwin", "win32"]) {
	for (const operation of ["mutate", "reset"] as const) {
		test(`Unqualified ${unqualifiedPlatform} ${operation} refuses before changing profile or locks`, async () => {
			const { store, path, lock } = await fixture();
			await store.mutate(profile => {
				profile.value = "before-unqualified-platform";
			});
			const original = await readFile(path, "utf8");
			const parent = join(path, "..");
			const beforeEntries = await filesystem.readdir(parent);
			const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
			expect(descriptor?.configurable).toBe(true);
			Object.defineProperty(process, "platform", { ...descriptor, value: unqualifiedPlatform });
			try {
				const invoke =
					operation === "reset"
						? () => store.reset()
						: () =>
								store.mutate(profile => {
									profile.value = "must-not-be-written";
								});
				const error = await invoke().then(
					() => undefined,
					failure => failure,
				);
				expect(error).toMatchObject({ code: "unsupported_platform" });
				expect(error.message).toContain(unqualifiedPlatform);
				expect(error.message).not.toContain("profile reset");
				expect(await readFile(path, "utf8")).toBe(original);
				expect(await filesystem.readdir(parent)).toEqual(beforeEntries);
				await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				Object.defineProperty(process, "platform", descriptor!);
			}
		});
	}
}
