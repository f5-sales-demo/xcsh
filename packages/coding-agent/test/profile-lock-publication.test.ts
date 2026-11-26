import { afterEach, expect, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateProfileStore } from "../src/person-profile/private-store";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => filesystem.rm(path, { recursive: true, force: true })));
});
async function fixture() {
	const directory = await filesystem.mkdtemp(join(tmpdir(), "profile-publication-owned-"));
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
	return { store, path, lock: `${path}.lock` };
}

test("owner preparation never exposes an active lock with incomplete attribution", async () => {
	const { store, lock } = await fixture();
	const started = Promise.withResolvers<void>();
	const proceed = Promise.withResolvers<void>();
	const originalOpen = filesystem.open;
	const methods: Array<{ mockRestore(): void }> = [];
	const opening = spyOn(filesystem, "open").mockImplementation(async (path, flags, mode) => {
		const handle = await originalOpen(path, flags, mode);
		if (String(path).endsWith("/owner.json")) {
			const originalWrite = handle.writeFile.bind(handle);
			methods.push(
				spyOn(handle, "writeFile").mockImplementation(async (data, options) => {
					started.resolve();
					await proceed.promise;
					return originalWrite(data, options);
				}),
			);
		}
		return handle;
	});
	const acquisition = store.acquireResetLease().then(
		lease => ({ lease }),
		error => ({ error }),
	);
	try {
		await Promise.race([
			started.promise,
			Bun.sleep(250).then(() => {
				throw new Error("Owner write interception unavailable");
			}),
		]);
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		proceed.resolve();
		const outcome = await acquisition;
		if ("lease" in outcome) await outcome.lease.release();
		for (const method of methods) method.mockRestore();
		opening.mockRestore();
	}
});

test("failed owner writing retains its failure without publishing an ambiguous active lock", async () => {
	const { store, lock } = await fixture();
	const originalOpen = filesystem.open;
	const methods: Array<{ mockRestore(): void }> = [];
	let injected = false;
	const opening = spyOn(filesystem, "open").mockImplementation(async (path, flags, mode) => {
		const handle = await originalOpen(path, flags, mode);
		if (String(path).endsWith("/owner.json")) {
			methods.push(
				spyOn(handle, "writeFile").mockImplementation(async () => {
					injected = true;
					throw new Error("synthetic-owner-write-failure");
				}),
			);
		}
		return handle;
	});
	try {
		await expect(store.acquireResetLease()).rejects.toThrow();
		expect(injected).toBe(true);
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		for (const method of methods) method.mockRestore();
		opening.mockRestore();
	}
});

test("failed owner durability never publishes an active lease", async () => {
	const { store, lock } = await fixture();
	const originalOpen = filesystem.open;
	const methods: Array<{ mockRestore(): void }> = [];
	let injected = false;
	const opening = spyOn(filesystem, "open").mockImplementation(async (path, flags, mode) => {
		const handle = await originalOpen(path, flags, mode);
		if (String(path).endsWith("/owner.json")) {
			methods.push(
				spyOn(handle, "sync").mockImplementation(async () => {
					injected = true;
					throw new Error("synthetic-owner-durability-failure");
				}),
			);
		}
		return handle;
	});
	try {
		await expect(store.acquireResetLease()).rejects.toThrow();
		expect(injected).toBe(true);
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		for (const method of methods) method.mockRestore();
		opening.mockRestore();
	}
});

test("cancellation during owner preparation refuses a lease and preserves profile absence", async () => {
	const { store, path, lock } = await fixture();
	const controller = new AbortController();
	const originalOpen = filesystem.open;
	const methods: Array<{ mockRestore(): void }> = [];
	let injected = false;
	const opening = spyOn(filesystem, "open").mockImplementation(async (ownerPath, flags, mode) => {
		const handle = await originalOpen(ownerPath, flags, mode);
		if (String(ownerPath).endsWith("/owner.json")) {
			const originalWrite = handle.writeFile.bind(handle);
			methods.push(
				spyOn(handle, "writeFile").mockImplementation(async (data, options) => {
					injected = true;
					controller.abort();
					return originalWrite(data, options);
				}),
			);
		}
		return handle;
	});
	try {
		const outcome = await store.acquireResetLease(controller.signal).then(
			lease => ({ lease }),
			error => ({ error }),
		);
		if ("lease" in outcome) await outcome.lease.release();
		expect(injected).toBe(true);
		expect("error" in outcome).toBe(true);
		if ("error" in outcome) expect(outcome.error.message).toContain("cancelled");
		await expect(filesystem.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(filesystem.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		for (const method of methods) method.mockRestore();
		opening.mockRestore();
	}
});
