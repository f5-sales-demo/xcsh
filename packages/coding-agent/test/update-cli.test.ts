import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderCommandHelp } from "@f5-sales-demo/pi-utils/cli";
import { _resolveUpdateMethodForTest, parseUpdateArgs } from "../src/cli/update-cli";
import SelfUpdate from "../src/commands/self-update";
import Update from "../src/commands/update";

describe("update command boundary", () => {
	it("recognizes only self-update as the executable updater", () => {
		expect(parseUpdateArgs(["self-update", "--check"])).toEqual({ force: false, check: true });
		expect(parseUpdateArgs(["self-update", "--force"])).toEqual({ force: true, check: false });
	});

	it("never interprets manifest update flags as executable updater flags", () => {
		expect(parseUpdateArgs(["update", "-f", "manifest.yaml"])).toBeUndefined();
	});

	it("exposes distinct public CLI contracts for update and self-update", () => {
		const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		try {
			renderCommandHelp("xcsh", "update", Update);
			const manifestUpdate = write.mock.calls.map(([chunk]) => String(chunk)).join("");
			write.mockClear();
			renderCommandHelp("xcsh", "self-update", SelfUpdate);
			const executableUpdate = write.mock.calls.map(([chunk]) => String(chunk)).join("");

			expect(manifestUpdate).toContain("Update existing resources from manifests");
			expect(manifestUpdate).toContain("--filename=<value>");
			expect(executableUpdate).toContain("Check for and install xcsh executable updates");
			expect(executableUpdate).toContain("--check");
		} finally {
			write.mockRestore();
		}
	});

	it("directs both English update notices to self-update", () => {
		const mainSource = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
		const messages = JSON.parse(
			fs.readFileSync(new URL("../src/locales/en.json", import.meta.url), "utf8"),
		) as Record<string, string>;

		expect(mainSource).toContain("run: xcsh self-update");
		expect(mainSource).not.toContain("run: xcsh update`");
		expect(messages["welcome.updateHint"]).toBe("run: xcsh self-update");
	});
});

describe("update-cli install target detection", () => {
	// --- Existing tests (bun and binary) ---

	it("uses bun update when prioritized xcsh is inside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/example/.bun/bin/xcsh", "/Users/example/.bun/bin");

		expect(method).toBe("bun");
	});

	it("uses binary update when prioritized xcsh is outside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/example/.local/bin/xcsh", "/Users/example/.bun/bin");

		expect(method).toBe("binary");
	});

	it("uses binary update when bun global bin cannot be resolved", () => {
		const method = _resolveUpdateMethodForTest("/Users/example/.local/bin/xcsh", undefined);

		expect(method).toBe("binary");
	});

	// --- Brew detection (path-based) ---

	it("uses brew update when path contains Cellar", () => {
		const method = _resolveUpdateMethodForTest("/opt/homebrew/Cellar/xcsh/15.5.0/bin/xcsh", undefined);

		expect(method).toBe("brew");
	});

	it("uses brew update when path contains homebrew", () => {
		const method = _resolveUpdateMethodForTest("/opt/homebrew/bin/xcsh", undefined);

		expect(method).toBe("brew");
	});

	it("prefers bun over brew when binary is in bun global bin under homebrew", () => {
		const method = _resolveUpdateMethodForTest("/opt/homebrew/.bun/bin/xcsh", "/opt/homebrew/.bun/bin");

		expect(method).toBe("bun");
	});

	// --- npm detection (symlink-based) ---

	describe("npm detection via symlinks", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-update-test-"));
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("uses npm update when binary is a symlink into node_modules", () => {
			// Create a fake node_modules structure
			const nodeModulesTarget = path.join(tmpDir, "node_modules", "@f5-sales-demo", "xcsh", "dist");
			fs.mkdirSync(nodeModulesTarget, { recursive: true });
			const targetFile = path.join(nodeModulesTarget, "xcsh");
			fs.writeFileSync(targetFile, "");

			// Create a symlink pointing into node_modules
			const symlink = path.join(tmpDir, "xcsh");
			fs.symlinkSync(path.join("node_modules", "@f5-sales-demo", "xcsh", "dist", "xcsh"), symlink);

			const method = _resolveUpdateMethodForTest(symlink, undefined);

			expect(method).toBe("npm");
		});

		it("uses npm update for chained symlinks resolving into node_modules", () => {
			// Create node_modules target
			const nodeModulesTarget = path.join(tmpDir, "lib", "node_modules", "@f5-sales-demo", "xcsh", "dist");
			fs.mkdirSync(nodeModulesTarget, { recursive: true });
			const targetFile = path.join(nodeModulesTarget, "xcsh");
			fs.writeFileSync(targetFile, "");

			// First symlink: usr/bin/xcsh -> lib/node_modules/.../xcsh
			const binDir = path.join(tmpDir, "usr", "bin");
			fs.mkdirSync(binDir, { recursive: true });
			const firstLink = path.join(binDir, "xcsh");
			fs.symlinkSync(path.join(tmpDir, "lib", "node_modules", "@f5-sales-demo", "xcsh", "dist", "xcsh"), firstLink);

			// Second symlink: local/bin/xcsh -> usr/bin/xcsh
			const localBinDir = path.join(tmpDir, "local", "bin");
			fs.mkdirSync(localBinDir, { recursive: true });
			const secondLink = path.join(localBinDir, "xcsh");
			fs.symlinkSync(firstLink, secondLink);

			const method = _resolveUpdateMethodForTest(secondLink, undefined);

			expect(method).toBe("npm");
		});
	});
});
