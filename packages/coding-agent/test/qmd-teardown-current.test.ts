import { Database } from "bun:sqlite";
import { afterEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "@tobilu/qmd";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function filename() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "qmd-owned-teardown-"));
	directories.push(directory);
	return path.join(directory, "corpus.sqlite");
}
function migrateImmediately(dbPath: string) {
	const database = new Database(dbPath);
	try {
		database.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE");
		return database.query("PRAGMA journal_mode").get();
	} finally {
		database.close();
	}
}
it("releases initialized SQLite and retained statements on concurrent public closes", async () => {
	const dbPath = await filename();
	const store = await createStore({ dbPath });
	store.internal.db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('qualification')");
	// QMD publishes the Node Statement type for both runtimes. Verify Bun here
	// before using its native finalization API in this Bun-only regression.
	expect(store.internal.db).toBeInstanceOf(Database);
	const retained = (store.internal.db as unknown as Database).prepare("SELECT value FROM sentinel");
	expect(retained.get()).toEqual({ value: "qualification" });
	try {
		await Promise.all([store.close(), store.close()]);
		expect(migrateImmediately(dbPath)).toEqual({ journal_mode: "delete" });
		expect(() => retained.get()).toThrow();
	} finally {
		retained.finalize();
		await store.close();
	}
});
it("closes only its own statements while another store remains usable", async () => {
	const dbPath = await filename();
	const first = await createStore({ dbPath });
	const second = await createStore({ dbPath });
	expect(second.internal.db).toBeInstanceOf(Database);
	const retained = (second.internal.db as unknown as Database).prepare("PRAGMA user_version");
	const version = retained.get();
	try {
		await first.close();
		expect(retained.get()).toEqual(version);
		expect(() => migrateImmediately(dbPath)).toThrow("database is locked");
		await second.close();
		expect(migrateImmediately(dbPath)).toEqual({ journal_mode: "delete" });
	} finally {
		retained.finalize();
		await first.close();
		await second.close();
	}
});
