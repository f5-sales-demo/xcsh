import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectAgentDir, Snowflake } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { YAML } from "bun";

describe("Settings — keybindings.chordTimeout", () => {
	let testDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		_resetSettingsForTest();

		testDir = path.join(os.tmpdir(), "test-settings-chord-tmp", Snowflake.next());
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

	it("returns the default of 1000 ms when unset", async () => {
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.get("keybindings.chordTimeout")).toBe(1000);
		expect(s.getChordTimeoutMs()).toBe(1000);
	});

	it("honors a user-provided value in range", async () => {
		await Bun.write(
			path.join(agentDir, "config.yml"),
			YAML.stringify({ keybindings: { chordTimeout: 750 } }, null, 2),
		);
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.get("keybindings.chordTimeout")).toBe(750);
		expect(s.getChordTimeoutMs()).toBe(750);
	});

	it("clamps a value below the minimum to 200 on read", async () => {
		await Bun.write(
			path.join(agentDir, "config.yml"),
			YAML.stringify({ keybindings: { chordTimeout: 50 } }, null, 2),
		);
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.getChordTimeoutMs()).toBe(200);
	});

	it("clamps a value above the maximum to 5000 on read", async () => {
		await Bun.write(
			path.join(agentDir, "config.yml"),
			YAML.stringify({ keybindings: { chordTimeout: 99_999 } }, null, 2),
		);
		const s = await Settings.init({ agentDir, cwd: projectDir });
		expect(s.getChordTimeoutMs()).toBe(5000);
	});

	it("falls back to default on a malformed (non-number) value", async () => {
		await Bun.write(
			path.join(agentDir, "config.yml"),
			YAML.stringify({ keybindings: { chordTimeout: "not-a-number" } }, null, 2),
		);
		const s = await Settings.init({ agentDir, cwd: projectDir });
		// Non-number falls back to 1000 default, which is in range.
		expect(s.getChordTimeoutMs()).toBe(1000);
	});
});
