import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resolveProject, saveConfig } from "../../src/tools/glab/config";

describe("loadConfig", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when config file does not exist", async () => {
		const result = await loadConfig(tmpDir);
		expect(result).toBeNull();
	});

	it("reads and parses valid config JSON", async () => {
		const config = {
			project: "mygroup/myrepo",
			hostname: "gitlab.com",
			defaultState: "opened",
			perPage: 30,
		};
		await fs.mkdir(path.join(tmpDir, ".xcsh"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".xcsh", "glab-config.json"), JSON.stringify(config), "utf8");
		const result = await loadConfig(tmpDir);
		expect(result?.project).toBe("mygroup/myrepo");
		expect(result?.hostname).toBe("gitlab.com");
	});

	it("returns null for malformed JSON", async () => {
		await fs.mkdir(path.join(tmpDir, ".xcsh"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".xcsh", "glab-config.json"), "not-json", "utf8");
		const result = await loadConfig(tmpDir);
		expect(result).toBeNull();
	});
});

describe("saveConfig", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("creates .xcsh directory and writes config", async () => {
		await saveConfig(tmpDir, { project: "group/repo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 });
		const raw = await fs.readFile(path.join(tmpDir, ".xcsh", "glab-config.json"), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.project).toBe("group/repo");
	});

	it("overwrites existing config", async () => {
		await saveConfig(tmpDir, { project: "old/repo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 });
		await saveConfig(tmpDir, { project: "new/repo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 });
		const result = await loadConfig(tmpDir);
		expect(result?.project).toBe("new/repo");
	});
});

describe("resolveProject", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns param project when provided directly", async () => {
		const result = await resolveProject("override/project", tmpDir);
		expect(result).toBe("override/project");
	});

	it("falls back to config file project", async () => {
		await saveConfig(tmpDir, {
			project: "config/project",
			hostname: "gitlab.com",
			defaultState: "opened",
			perPage: 30,
		});
		const result = await resolveProject(undefined, tmpDir);
		expect(result).toBe("config/project");
	});

	it("returns null when no project anywhere", async () => {
		const result = await resolveProject(undefined, tmpDir);
		expect(result).toBeNull();
	});
});
