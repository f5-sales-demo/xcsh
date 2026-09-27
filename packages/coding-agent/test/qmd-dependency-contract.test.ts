import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const qmdEntrypoint = Bun.resolveSync("@tobilu/qmd", import.meta.dir);
const qmdDatabaseModule = path.join(path.dirname(qmdEntrypoint), "db.js");
const qmdStoreModule = path.join(path.dirname(qmdEntrypoint), "store.js");

describe("QMD dependency patch", () => {
	it("keeps Bun on its embedded SQLite instead of selecting Homebrew SQLite", async () => {
		const source = await readFile(qmdDatabaseModule, "utf8");

		expect(source).not.toContain("setCustomSQLite");
		expect(source).not.toContain("/opt/homebrew/opt/sqlite");
		expect(source).not.toContain("/usr/local/opt/sqlite");
	});

	it("does not warn when the optional sqlite-vec extension is unavailable to BM25", async () => {
		const source = await readFile(qmdStoreModule, "utf8");
		expect(source).not.toContain("console.warn(_sqliteVecUnavailableReason)");
	});

	it("opens prebuilt BM25 indexes read-only without changing their journal mode", async () => {
		const [databaseSource, indexSource, storeSource] = await Promise.all([
			readFile(qmdDatabaseModule, "utf8"),
			readFile(qmdEntrypoint, "utf8"),
			readFile(qmdStoreModule, "utf8"),
		]);

		expect(databaseSource).toContain("if (!options.readonly)");
		expect(indexSource).toContain("readonly: options.readonly");
		expect(storeSource).toContain("if (!options.readonly)");
	});
});
