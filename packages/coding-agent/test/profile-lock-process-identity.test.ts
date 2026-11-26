import { afterEach, expect, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => filesystem.rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const root = await filesystem.mkdtemp(join(tmpdir(), "profile-process-identity-"));
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
		profile.value = "before-identity-refusal";
	});
	return { store, path, lock: `${path}.lock`, profile: await filesystem.readFile(path, "utf8") };
}
const targets = {
	process: "/proc/self/stat",
	boot: "/proc/sys/kernel/random/boot_id",
	machine: "/etc/machine-id",
};
function changedValue(kind: keyof typeof targets, raw: string) {
	if (kind === "boot")
		return raw.trim() === "11111111-1111-4111-8111-111111111111"
			? "22222222-2222-4222-8222-222222222222\n"
			: "11111111-1111-4111-8111-111111111111\n";
	if (kind === "machine")
		return raw.trim() === "11111111111111111111111111111111"
			? "22222222222222222222222222222222\n"
			: "11111111111111111111111111111111\n";
	const end = raw.lastIndexOf(")") + 2;
	const fields = raw.slice(end).trim().split(/\s+/);
	fields[19] = String(BigInt(fields[19]!) + 1n);
	return raw.slice(0, end) + fields.join(" ");
}
async function alterIdentity(kind: keyof typeof targets, skipFirst: boolean) {
	const values = await Promise.all(Object.values(targets).map(path => filesystem.readFile(path, "utf8")));
	const kinds = Object.keys(targets) as (keyof typeof targets)[];
	const injection = spyOn(filesystem, "readFile");
	for (let round = 0; round < 16; round++) {
		for (const [index, current] of kinds.entries()) {
			const value = values[index]!;
			injection.mockResolvedValueOnce(
				current === kind && !(skipFirst && round === 0) ? changedValue(kind, value) : value,
			);
		}
	}
	return {
		injection,
		observations: () => injection.mock.calls.filter(args => String(args[0]) === targets[kind]).length,
	};
}

for (const kind of ["process", "boot", "machine"] as const) {
	test.skipIf(process.platform !== "linux")(
		`Changed original ${kind} before publication refuses mutation`,
		async () => {
			const { store, path, profile, lock } = await fixture();
			const { injection, observations } = await alterIdentity(kind, true);
			let changed = false;
			try {
				const outcome = await store
					.mutate(value => {
						changed = true;
						value.value = "must-not-be-written";
					})
					.then(
						() => undefined,
						error => error,
					);
				const observed = observations();
				injection.mockRestore();
				expect(outcome).toMatchObject({ code: "ownership_mismatch" });
				expect(observed).toBeGreaterThanOrEqual(2);
				expect(changed).toBe(false);
				expect(await filesystem.readFile(path, "utf8")).toBe(profile);
				await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				injection.mockRestore();
			}
		},
	);
	test.skipIf(process.platform !== "linux")(
		`Changed original ${kind} after acquisition refuses reset and release`,
		async () => {
			const { store, path, profile, lock } = await fixture();
			const lease = await store.acquireResetLease();
			const owner = await filesystem.readFile(join(lock, "owner.json"), "utf8");
			const { injection } = await alterIdentity(kind, false);
			try {
				await expect(lease.inspect()).rejects.toThrow("ownership_mismatch");
				await expect(lease.remove()).rejects.toThrow("ownership_mismatch");
				await expect(lease.release()).rejects.toThrow("ownership_mismatch");
				injection.mockRestore();
				expect(await filesystem.readFile(path, "utf8")).toBe(profile);
				expect(await filesystem.readFile(join(lock, "owner.json"), "utf8")).toBe(owner);
			} finally {
				injection.mockRestore();
			}
		},
	);
}

for (const invalid of ["wrong-pid", "missing-comm", "zero-start", "malformed-boot"] as const) {
	test.skipIf(process.platform !== "linux")(
		`Malformed original attribution ${invalid} refuses before publication`,
		async () => {
			const { store, path, profile, lock } = await fixture();
			const values = await Promise.all(Object.values(targets).map(path => filesystem.readFile(path, "utf8")));
			let processStat = values[0]!;
			if (invalid === "wrong-pid") processStat = processStat.replace(/^\d+/, String(process.pid + 1));
			if (invalid === "missing-comm") processStat = processStat.replace(/[()]/g, "");
			if (invalid === "zero-start") {
				const end = processStat.lastIndexOf(")") + 2;
				const fields = processStat.slice(end).trim().split(/\s+/);
				fields[19] = "0";
				processStat = processStat.slice(0, end) + fields.join(" ");
			}
			const injection = spyOn(filesystem, "readFile")
				.mockResolvedValueOnce(processStat)
				.mockResolvedValueOnce(invalid === "malformed-boot" ? "------------------------------------" : values[1]!)
				.mockResolvedValueOnce(values[2]!);
			try {
				await expect(
					store.mutate(value => {
						value.value = "must-not-be-written";
					}),
				).rejects.toThrow("persistence_unavailable");
				injection.mockRestore();
				expect(await filesystem.readFile(path, "utf8")).toBe(profile);
				await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				injection.mockRestore();
			}
		},
	);
}
