import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const qmdEntrypoint = Bun.resolveSync("@tobilu/qmd", import.meta.dir);
const qmdDatabaseModule = path.join(path.dirname(qmdEntrypoint), "db.js");
const qmdStoreModule = path.join(path.dirname(qmdEntrypoint), "store.js");

describe("QMD dependency patch", () => {
	it("keeps QMD build-only so downstream CLI installs do not run unused native build scripts", async () => {
		const codingAgentPackage = JSON.parse(
			await readFile(path.resolve(import.meta.dir, "..", "package.json"), "utf8"),
		) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

		expect(codingAgentPackage.dependencies?.["@tobilu/qmd"]).toBeUndefined();
		expect(codingAgentPackage.devDependencies?.["@tobilu/qmd"]).toBe("2.8.3");
	});

	it("uses bundled better-sqlite3 binaries without running its node-gyp fallback", async () => {
		const rootPackage = JSON.parse(
			await readFile(path.resolve(import.meta.dir, "../../..", "package.json"), "utf8"),
		) as { devDependencies?: Record<string, string>; trustedDependencies?: string[] };

		expect(rootPackage.devDependencies?.["node-gyp"]).toBeUndefined();
		expect(rootPackage.trustedDependencies).toEqual(["puppeteer", "tree-sitter-typescript"]);
	});

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
