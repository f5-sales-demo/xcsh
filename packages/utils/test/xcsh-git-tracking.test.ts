// packages/utils/test/xcsh-git-tracking.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContextResolver } from "../src/xcsh-context-resolver";

describe("ContextResolver.checkGitTracking", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-git-track-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns false for untracked file", async () => {
		// Init a git repo
		Bun.spawnSync(["git", "init"], { cwd: tmpDir });
		const filePath = path.join(tmpDir, "untracked.json");
		fs.writeFileSync(filePath, "{}");

		const resolver = new ContextResolver();
		const result = await resolver.checkGitTracking(filePath);
		expect(result).toBe(false);
	});

	it("returns true for tracked file", async () => {
		Bun.spawnSync(["git", "init"], { cwd: tmpDir });
		const filePath = path.join(tmpDir, "tracked.json");
		fs.writeFileSync(filePath, "{}");
		Bun.spawnSync(["git", "add", "tracked.json"], { cwd: tmpDir });
		Bun.spawnSync(["git", "commit", "-m", "add", "--no-gpg-sign"], { cwd: tmpDir });

		const resolver = new ContextResolver();
		const result = await resolver.checkGitTracking(filePath);
		expect(result).toBe(true);
	});

	it("returns false when not in a git repo", async () => {
		const filePath = path.join(tmpDir, "no-git.json");
		fs.writeFileSync(filePath, "{}");

		const resolver = new ContextResolver();
		const result = await resolver.checkGitTracking(filePath);
		expect(result).toBe(false);
	});
});
