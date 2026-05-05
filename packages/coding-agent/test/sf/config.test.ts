import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearUserProfile, getProfilePath, loadUserProfile, saveUserProfile } from "../../src/tools/sf/config";

describe("getProfilePath", () => {
	let originalHome: string | undefined;

	beforeEach(() => {
		originalHome = process.env.HOME;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
	});

	it("returns path under HOME/.xcsh/sf-profile.json", () => {
		process.env.HOME = "/fakehome";
		expect(getProfilePath()).toBe("/fakehome/.xcsh/sf-profile.json");
	});
});

describe("loadUserProfile", () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when profile file does not exist", async () => {
		const result = await loadUserProfile();
		expect(result).toBeNull();
	});

	it("returns null when profile is missing required fields", async () => {
		await fs.mkdir(path.join(tmpDir, ".xcsh"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".xcsh", "sf-profile.json"), JSON.stringify({ userId: "005abc" }), "utf8");
		const result = await loadUserProfile();
		expect(result).toBeNull();
	});

	it("reads profile from xcsh-owned file", async () => {
		await fs.mkdir(path.join(tmpDir, ".xcsh"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, ".xcsh", "sf-profile.json"),
			JSON.stringify({
				userId: "005abc123",
				username: "test@example.com",
				firstName: "Jane",
				lastName: "Doe",
				email: "jane@example.com",
				fetchedAt: "2026-01-01T00:00:00.000Z",
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

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("writes profile to xcsh-owned file, not sf config", async () => {
		await saveUserProfile({
			userId: "005abc",
			username: "user@example.com",
			firstName: "First",
			lastName: "Last",
			email: "user@example.com",
			fetchedAt: "2026-01-01T00:00:00.000Z",
		});

		// Profile file exists
		const raw = await fs.readFile(path.join(tmpDir, ".xcsh", "sf-profile.json"), "utf8");
		const profile = JSON.parse(raw);
		expect(profile.userId).toBe("005abc");
		expect(profile.username).toBe("user@example.com");

		// sf config.json must NOT be created or modified
		const sfConfigExists = await fs
			.access(path.join(tmpDir, ".sf", "config.json"))
			.then(() => true)
			.catch(() => false);
		expect(sfConfigExists).toBe(false);
	});

	it("creates .xcsh directory if missing", async () => {
		await saveUserProfile({
			userId: "005xyz",
			username: "new@example.com",
			firstName: "New",
			lastName: "User",
			email: "new@example.com",
			fetchedAt: "2026-02-01T00:00:00.000Z",
		});
		const raw = await fs.readFile(path.join(tmpDir, ".xcsh", "sf-profile.json"), "utf8");
		const profile = JSON.parse(raw);
		expect(profile.userId).toBe("005xyz");
	});

	it("preserves optional fields when present", async () => {
		await saveUserProfile({
			userId: "005opt",
			username: "opt@example.com",
			firstName: "Optional",
			lastName: "Fields",
			email: "opt@example.com",
			title: "Engineer",
			department: "R&D",
			fetchedAt: "2026-03-01T00:00:00.000Z",
		});
		const raw = await fs.readFile(path.join(tmpDir, ".xcsh", "sf-profile.json"), "utf8");
		const profile = JSON.parse(raw);
		expect(profile.title).toBe("Engineer");
		expect(profile.department).toBe("R&D");
	});
});

describe("clearUserProfile", () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("deletes the profile file", async () => {
		await fs.mkdir(path.join(tmpDir, ".xcsh"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, ".xcsh", "sf-profile.json"),
			JSON.stringify({ userId: "005remove" }),
			"utf8",
		);
		await clearUserProfile();
		const exists = await fs
			.access(path.join(tmpDir, ".xcsh", "sf-profile.json"))
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});

	it("does not throw when profile file does not exist", async () => {
		await expect(clearUserProfile()).resolves.toBeUndefined();
	});
});
