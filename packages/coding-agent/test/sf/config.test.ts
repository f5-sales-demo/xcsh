import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearUserProfile, getSfConfigPath, loadUserProfile, saveUserProfile } from "../../src/tools/sf/config";

describe("getSfConfigPath", () => {
	let originalHome: string | undefined;
	let originalSfHome: string | undefined;

	beforeEach(() => {
		originalHome = process.env.HOME;
		originalSfHome = process.env.SF_HOME;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		if (originalSfHome === undefined) {
			delete process.env.SF_HOME;
		} else {
			process.env.SF_HOME = originalSfHome;
		}
	});

	it("returns default path under HOME when SF_HOME is not set", () => {
		process.env.HOME = "/fakehome";
		delete process.env.SF_HOME;
		expect(getSfConfigPath()).toBe("/fakehome/.sf/config.json");
	});

	it("returns path under SF_HOME when SF_HOME is set", () => {
		process.env.SF_HOME = "/custom/sf";
		expect(getSfConfigPath()).toBe("/custom/sf/config.json");
	});
});

describe("loadUserProfile", () => {
	let tmpDir: string;
	let originalHome: string | undefined;
	let originalSfHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-test-"));
		originalHome = process.env.HOME;
		originalSfHome = process.env.SF_HOME;
		process.env.HOME = tmpDir;
		delete process.env.SF_HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalSfHome === undefined) {
			delete process.env.SF_HOME;
		} else {
			process.env.SF_HOME = originalSfHome;
		}
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when config file does not exist", async () => {
		await fs.rm(path.join(tmpDir, ".sf"), { recursive: true, force: true });
		const result = await loadUserProfile();
		expect(result).toBeNull();
	});

	it("returns null when no xcsh.user.* keys are present", async () => {
		await fs.mkdir(path.join(tmpDir, ".sf"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".sf", "config.json"), JSON.stringify({ "target-org": "f5" }), "utf8");
		const result = await loadUserProfile();
		expect(result).toBeNull();
	});

	it("reads xcsh.user.* keys correctly", async () => {
		await fs.mkdir(path.join(tmpDir, ".sf"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, ".sf", "config.json"),
			JSON.stringify({
				"xcsh.user.id": "005abc123",
				"xcsh.user.username": "test@example.com",
				"xcsh.user.firstName": "Jane",
				"xcsh.user.lastName": "Doe",
				"xcsh.user.email": "jane@example.com",
				"xcsh.user.fetchedAt": "2026-01-01T00:00:00.000Z",
			}),
			"utf8",
		);
		const result = await loadUserProfile();
		expect(result).not.toBeNull();
		expect(result?.userId).toBe("005abc123");
		expect(result?.firstName).toBe("Jane");
		expect(result?.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
	});
});

describe("saveUserProfile", () => {
	let tmpDir: string;
	let originalHome: string | undefined;
	let originalSfHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-test-"));
		originalHome = process.env.HOME;
		originalSfHome = process.env.SF_HOME;
		process.env.HOME = tmpDir;
		delete process.env.SF_HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalSfHome === undefined) {
			delete process.env.SF_HOME;
		} else {
			process.env.SF_HOME = originalSfHome;
		}
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("preserves existing sf CLI keys when saving profile", async () => {
		await fs.mkdir(path.join(tmpDir, ".sf"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, ".sf", "config.json"),
			JSON.stringify({
				"target-org": "my-org",
				"disable-telemetry": "true",
			}),
			"utf8",
		);
		await saveUserProfile({
			userId: "005abc",
			username: "user@example.com",
			firstName: "First",
			lastName: "Last",
			email: "user@example.com",
			fetchedAt: "2026-01-01T00:00:00.000Z",
		});
		const raw = await fs.readFile(path.join(tmpDir, ".sf", "config.json"), "utf8");
		const config = JSON.parse(raw);
		expect(config["target-org"]).toBe("my-org");
		expect(config["disable-telemetry"]).toBe("true");
		expect(config["xcsh.user.id"]).toBe("005abc");
		expect(config["xcsh.user.username"]).toBe("user@example.com");
	});

	it("creates .sf directory if missing", async () => {
		await fs.rm(path.join(tmpDir, ".sf"), { recursive: true, force: true });
		await saveUserProfile({
			userId: "005xyz",
			username: "new@example.com",
			firstName: "New",
			lastName: "User",
			email: "new@example.com",
			fetchedAt: "2026-02-01T00:00:00.000Z",
		});
		const raw = await fs.readFile(path.join(tmpDir, ".sf", "config.json"), "utf8");
		const config = JSON.parse(raw);
		expect(config["xcsh.user.id"]).toBe("005xyz");
	});

	it("omits undefined optional fields", async () => {
		await saveUserProfile({
			userId: "005opt",
			username: "opt@example.com",
			firstName: "Optional",
			lastName: "Fields",
			email: "opt@example.com",
			fetchedAt: "2026-03-01T00:00:00.000Z",
		});
		const raw = await fs.readFile(path.join(tmpDir, ".sf", "config.json"), "utf8");
		const config = JSON.parse(raw);
		expect(config["xcsh.user.title"]).toBeUndefined();
	});

	it("throws on invalid JSON instead of silently overwriting", async () => {
		await fs.mkdir(path.join(tmpDir, ".sf"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".sf", "config.json"), "NOT VALID JSON{{{", "utf8");
		await expect(
			saveUserProfile({
				userId: "005bad",
				username: "bad@example.com",
				firstName: "Bad",
				lastName: "Config",
				email: "bad@example.com",
				fetchedAt: "2026-04-01T00:00:00.000Z",
			}),
		).rejects.toThrow();
		// Verify the original file was not overwritten
		const raw = await fs.readFile(path.join(tmpDir, ".sf", "config.json"), "utf8");
		expect(raw).toBe("NOT VALID JSON{{{");
	});
});

describe("clearUserProfile", () => {
	let tmpDir: string;
	let originalHome: string | undefined;
	let originalSfHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-test-"));
		originalHome = process.env.HOME;
		originalSfHome = process.env.SF_HOME;
		process.env.HOME = tmpDir;
		delete process.env.SF_HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalSfHome === undefined) {
			delete process.env.SF_HOME;
		} else {
			process.env.SF_HOME = originalSfHome;
		}
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("removes xcsh.user.* keys but preserves other keys", async () => {
		await fs.mkdir(path.join(tmpDir, ".sf"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, ".sf", "config.json"),
			JSON.stringify({
				"target-org": "keep-me",
				"xcsh.user.id": "005remove",
				"xcsh.user.username": "remove@example.com",
			}),
			"utf8",
		);
		await clearUserProfile();
		const raw = await fs.readFile(path.join(tmpDir, ".sf", "config.json"), "utf8");
		const config = JSON.parse(raw);
		expect(config["target-org"]).toBe("keep-me");
		expect(config["xcsh.user.id"]).toBeUndefined();
		expect(config["xcsh.user.username"]).toBeUndefined();
	});

	it("throws on invalid JSON instead of silently wiping config", async () => {
		await fs.mkdir(path.join(tmpDir, ".sf"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".sf", "config.json"), "CORRUPT DATA", "utf8");
		await expect(clearUserProfile()).rejects.toThrow();
		// Verify the original file was not overwritten
		const raw = await fs.readFile(path.join(tmpDir, ".sf", "config.json"), "utf8");
		expect(raw).toBe("CORRUPT DATA");
	});
});
