import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureGlabConfig, loadConfig, parseAuthStatus, resolveProject, saveConfig } from "../../src/tools/glab/config";

describe("loadConfig", () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when config file does not exist", async () => {
		const result = await loadConfig(tmpDir);
		expect(result).toBeNull();
	});

	it("reads and parses valid config JSON", async () => {
		const config = { project: "mygroup/myrepo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 };
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

	it("falls back to user-level config when project config missing", async () => {
		const config = { project: "user/repo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 };
		const userDir = path.join(tmpDir, ".xcsh", "agent");
		await fs.mkdir(userDir, { recursive: true });
		await fs.writeFile(path.join(userDir, "glab-config.json"), JSON.stringify(config), "utf8");
		const result = await loadConfig(tmpDir);
		expect(result?.project).toBe("user/repo");
	});
});

describe("saveConfig", () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("creates .xcsh directory and writes project-level config", async () => {
		await saveConfig(tmpDir, { project: "group/repo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 });
		const raw = await fs.readFile(path.join(tmpDir, ".xcsh", "glab-config.json"), "utf8");
		expect(JSON.parse(raw).project).toBe("group/repo");
	});

	it("also saves to user-level for cross-directory access", async () => {
		await saveConfig(tmpDir, { project: "group/repo", hostname: "gitlab.com", defaultState: "opened", perPage: 30 });
		// Use process.env.HOME (not os.homedir() which is cached) to match what saveConfig writes
		const userConfig = path.join(process.env.HOME!, ".xcsh", "agent", "glab-config.json");
		const raw = await fs.readFile(userConfig, "utf8");
		expect(JSON.parse(raw).project).toBe("group/repo");
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
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
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

describe("ensureGlabConfig", () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glab-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns existing config when project is already set", async () => {
		const existing = {
			project: "custom/project",
			hostname: "gitlab.example.com",
			defaultState: "closed" as const,
			perPage: 50,
		};
		await saveConfig(tmpDir, existing);
		const result = await ensureGlabConfig(tmpDir);
		expect(result.project).toBe("custom/project");
		expect(result.hostname).toBe("gitlab.example.com");
	});

	it("creates config with defaults when none exists", async () => {
		const result = await ensureGlabConfig(tmpDir);
		expect(result.hostname).toBe("gitlab.com");
		expect(result.defaultState).toBe("opened");
		expect(result.perPage).toBe(100);
		expect(result.project).toBeUndefined();
	});

	it("merges detected hostname into new config", async () => {
		const result = await ensureGlabConfig(tmpDir, { hostname: "gitlab.example.com" });
		expect(result.hostname).toBe("gitlab.example.com");
		expect(result.project).toBeUndefined();
	});

	it("merges detected project into new config", async () => {
		const result = await ensureGlabConfig(tmpDir, { project: "detected/project" });
		expect(result.project).toBe("detected/project");
	});

	it("preserves existing project over detected value", async () => {
		await saveConfig(tmpDir, {
			project: "existing/project",
			hostname: "gitlab.com",
			defaultState: "opened",
			perPage: 100,
		});
		const result = await ensureGlabConfig(tmpDir, { project: "detected/project" });
		expect(result.project).toBe("existing/project");
	});

	it("persists newly created config to disk", async () => {
		await ensureGlabConfig(tmpDir, { project: "new/project" });
		const loaded = await loadConfig(tmpDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.project).toBe("new/project");
	});

	it("is idempotent — second call returns same config", async () => {
		const first = await ensureGlabConfig(tmpDir, { hostname: "gitlab.example.com" });
		const second = await ensureGlabConfig(tmpDir);
		expect(first.hostname).toBe(second.hostname);
	});
});

describe("parseAuthStatus", () => {
	it("extracts hostname and user from standard output", () => {
		const output = [
			"gitlab.com",
			"  ✓ Logged in to gitlab.com as jdoe (/path/to/config.yml)",
			"  ✓ Git operations for gitlab.com configured to use https protocol.",
		].join("\n");
		const { hostname, user } = parseAuthStatus(output);
		expect(hostname).toBe("gitlab.com");
		expect(user).toBe("jdoe");
	});

	it("handles self-hosted hostname", () => {
		const output = "gitlab.example.com\n  ✓ Logged in to gitlab.example.com as admin (/config.yml)";
		const { hostname, user } = parseAuthStatus(output);
		expect(hostname).toBe("gitlab.example.com");
		expect(user).toBe("admin");
	});

	it("falls back to first line when no Logged in pattern", () => {
		const output = "gitlab.example.com\n  some other output";
		const { hostname } = parseAuthStatus(output);
		expect(hostname).toBe("gitlab.example.com");
	});
});
