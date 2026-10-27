import { expect, test } from "bun:test";
import { mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthCredentialStore } from "../src/auth-storage";

test.skipIf(process.platform !== "linux")(
	"closing auth storage releases SQLite descriptors without garbage collection",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "xcsh-auth-close-"));
		const database = join(directory, "auth.db");
		const store = await AuthCredentialStore.open(database);
		const databaseDescriptors = async () => {
			const descriptors = await readdir(`/proc/${process.pid}/fd`);
			const targets = await Promise.all(
				descriptors.map(fd => readlink(`/proc/${process.pid}/fd/${fd}`).catch(() => "")),
			);
			return targets.filter(
				target => target === database || target === `${database}-wal` || target === `${database}-shm`,
			);
		};
		try {
			store.replaceAuthCredentialsForProvider("fixture-oauth", [
				{ type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: Date.now() + 60000 },
			]);
			const row = store.listAuthCredentials()[0];
			store.updateAuthCredential(row.id, row.credential);
			expect(store.tryAcquireCredentialRefreshLease(row.id, "fixture-owner", Date.now() + 60000)).toBe(true);
			store.getCredentialRefreshLeaseExpiresAt(row.id);
			store.renewCredentialRefreshLease(row.id, "fixture-owner", Date.now() + 60000);
			store.releaseCredentialRefreshLease(row.id, "fixture-owner");
			expect((await databaseDescriptors()).length).toBeGreaterThan(0);
			store.close();
			// Keep the store reachable and avoid GC so deferred SQLite cleanup cannot hide a leak.
			expect(await databaseDescriptors()).toEqual([]);
			expect(() => store.close()).not.toThrow();
		} finally {
			store.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
