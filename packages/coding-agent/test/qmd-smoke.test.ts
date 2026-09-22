import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QMD_SMOKE_SUCCESS, runQmdSmoke } from "../src/qmd-smoke";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("QMD compiled-binary smoke", () => {
	it("ranks the DNS clone category first and opens the agent database afterward", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "xcsh-qmd-smoke-"));
		tempDirectories.push(home);
		const agentDatabasePath = path.join(home, ".xcsh", "agent", "agent.db");

		expect(
			await runQmdSmoke({
				cacheRoot: path.join(home, ".xcsh", "cache", "qmd-api-catalog"),
				agentDatabasePath,
			}),
		).toBe(QMD_SMOKE_SUCCESS);

		const database = new Database(agentDatabasePath, { readonly: true });
		try {
			const settings = database
				.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
				.get() as { name?: string } | null;
			expect(settings?.name).toBe("settings");
		} finally {
			database.close();
		}
	});
});
