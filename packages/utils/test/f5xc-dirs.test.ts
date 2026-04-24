import { afterEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { getF5XCActiveContextPath, getF5XCConfigDir, getF5XCContextPath, getF5XCContextsDir } from "../src/dirs";

describe("F5XC XDG path helpers", () => {
	const originalXdgConfig = process.env.XDG_CONFIG_HOME;

	afterEach(() => {
		if (originalXdgConfig === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfig;
		}
	});

	describe("getF5XCConfigDir", () => {
		it("returns ~/.config/f5xc when XDG_CONFIG_HOME is not set", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "f5xc");
			expect(getF5XCConfigDir()).toBe(expected);
		});

		it("returns $XDG_CONFIG_HOME/f5xc when XDG_CONFIG_HOME is set", () => {
			process.env.XDG_CONFIG_HOME = "/custom/config";
			expect(getF5XCConfigDir()).toBe("/custom/config/f5xc");
		});
	});

	describe("getF5XCContextsDir", () => {
		it("returns config dir + /contexts", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "f5xc", "contexts");
			expect(getF5XCContextsDir()).toBe(expected);
		});
	});

	describe("getF5XCActiveContextPath", () => {
		it("returns config dir + /active_context", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "f5xc", "active_context");
			expect(getF5XCActiveContextPath()).toBe(expected);
		});
	});

	describe("getF5XCContextPath", () => {
		it("returns contexts dir + /<name>.json", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "f5xc", "contexts", "production.json");
			expect(getF5XCContextPath("production")).toBe(expected);
		});
	});
});
