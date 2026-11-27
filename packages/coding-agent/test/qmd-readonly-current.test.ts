import { afterEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "@tobilu/qmd";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function filename() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "qmd-current-readonly-"));
	directories.push(directory);
	return path.join(directory, "corpus.sqlite");
}

it("refuses writes through the actual QMD store and preserves database bytes", async () => {
	const dbPath = await filename();
	const writable = await createStore({ dbPath });
	writable.internal.db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('qualification');");
	await writable.close();
	const digest = async () =>
		createHash("sha256")
			.update(await readFile(dbPath))
			.digest("hex");
	const before = await digest();
	const readonly = await createStore({ dbPath, readonly: true });
	try {
		expect(readonly.internal.db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
		expect(() => readonly.internal.db.exec("INSERT INTO sentinel VALUES ('unexpected-write')")).toThrow();
	} finally {
		await readonly.close();
	}
	expect(await digest()).toBe(before);
});

it("refuses a mutable configuration for a read-only store", async () => {
	const dbPath = await filename();
	await expect(createStore({ dbPath, readonly: true, config: { collections: {} } })).rejects.toThrow(
		"Read-only stores require existing database configuration",
	);
	expect(await Bun.file(dbPath).exists()).toBe(false);
});

it("does not create a missing read-only database", async () => {
	const dbPath = await filename();
	await expect(createStore({ dbPath, readonly: true })).rejects.toThrow();
	expect(await Bun.file(dbPath).exists()).toBe(false);
});
