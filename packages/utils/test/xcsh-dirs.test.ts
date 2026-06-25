import { afterEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { getXCShActiveContextPath, getXCShConfigDir, getXCShContextPath, getXCShContextsDir } from "../src/dirs";

describe("XCSH XDG path helpers", () => {
	const originalXdgConfig = process.env.XDG_CONFIG_HOME;

	afterEach(() => {
		if (originalXdgConfig === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfig;
		}
	});

	describe("getXCShConfigDir", () => {
		it("returns ~/.config/xcsh when XDG_CONFIG_HOME is not set", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "xcsh");
			expect(getXCShConfigDir()).toBe(expected);
		});

		it("returns $XDG_CONFIG_HOME/xcsh when XDG_CONFIG_HOME is set", () => {
			process.env.XDG_CONFIG_HOME = "/custom/config";
			expect(getXCShConfigDir()).toBe("/custom/config/xcsh");
		});
	});

	describe("getXCShContextsDir", () => {
		it("returns config dir + /contexts", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "xcsh", "contexts");
			expect(getXCShContextsDir()).toBe(expected);
		});
	});

	describe("getXCShActiveContextPath", () => {
		it("returns config dir + /active_context", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "xcsh", "active_context");
			expect(getXCShActiveContextPath()).toBe(expected);
		});
	});

	describe("getXCShContextPath", () => {
		it("returns contexts dir + /<name>.json", () => {
			delete process.env.XDG_CONFIG_HOME;
			const expected = path.join(os.homedir(), ".config", "xcsh", "contexts", "production.json");
			expect(getXCShContextPath("production")).toBe(expected);
		});
	});
});
