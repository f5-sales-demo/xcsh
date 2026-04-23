import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectAgentDir, Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { YAML } from "bun";

describe("Settings — sidebar.visible", () => {
	let testDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		_resetSettingsForTest();

		testDir = path.join(os.tmpdir(), "test-settings-sidebar-visible-tmp", Snowflake.next());
		agentDir = path.join(testDir, "agent");
		projectDir = path.join(testDir, "project");

		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(getProjectAgentDir(projectDir), { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("defaults to true when unset", async () => {
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.get("sidebar.visible")).toBe(true);
	});

	it("honors a user-provided false", async () => {
		await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify({ sidebar: { visible: false } }, null, 2));
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.get("sidebar.visible")).toBe(false);
	});
});

describe("Settings — sidebar.width", () => {
	let testDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		_resetSettingsForTest();

		testDir = path.join(os.tmpdir(), "test-settings-sidebar-width-tmp", Snowflake.next());
		agentDir = path.join(testDir, "agent");
		projectDir = path.join(testDir, "project");

		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(getProjectAgentDir(projectDir), { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("returns the default of 32 columns when unset", async () => {
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.get("sidebar.width")).toBe(32);
		expect(s.getSidebarWidth()).toBe(32);
	});

	it("honors a user-provided value in range", async () => {
		await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify({ sidebar: { width: 48 } }, null, 2));
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.get("sidebar.width")).toBe(48);
		expect(s.getSidebarWidth()).toBe(48);
	});

	it("clamps a value below the minimum to 20 on read", async () => {
		await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify({ sidebar: { width: 5 } }, null, 2));
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.getSidebarWidth()).toBe(20);
	});

	it("clamps a value above the maximum to 80 on read", async () => {
		await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify({ sidebar: { width: 999 } }, null, 2));
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.getSidebarWidth()).toBe(80);
	});

	it("falls back to default on a malformed (non-number) value", async () => {
		await Bun.write(
			path.join(agentDir, "config.yml"),
			YAML.stringify({ sidebar: { width: "not-a-number" } }, null, 2),
		);
		const s = await Settings.init({ agentDir, cwd: projectDir });
		// Non-number falls back to 32 default, which is in range.
		expect(s.getSidebarWidth()).toBe(32);
	});
});
