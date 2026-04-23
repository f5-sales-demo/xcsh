import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { type F5XCProfile, ProfileService } from "@f5xc-salesdemos/xcsh/services/f5xc-profile";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@f5xc-salesdemos/xcsh/slash-commands/builtin-registry";
import { TEST_PROFILE, TEST_PROFILE_INCOMPATIBLE, TEST_PROFILE_STAGING } from "./f5xc-test-fixtures";

function writeProfile(profilesDir: string, profile: F5XCProfile): void {
	fs.mkdirSync(profilesDir, { recursive: true });
	fs.writeFileSync(path.join(profilesDir, `${profile.name}.json`), JSON.stringify(profile, null, 2), { mode: 0o600 });
}

function _writeActiveProfile(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_profile"), name, { mode: 0o644 });
}

function getProfileSubcommand(name: string) {
	const profileCmd = BUILTIN_SLASH_COMMAND_DEFS.find(c => c.name === "profile");
	if (!profileCmd?.subcommands) throw new Error("profile command not found in registry");
	const sub = profileCmd.subcommands.find(s => s.name === name);
	if (!sub) throw new Error(`subcommand '${name}' not found under /profile`);
	return sub;
}

describe("/profile activate completion", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcProfilesDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ProfileService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-profile-completion", Snowflake.next());
		f5xcConfigDir = path.join(testDir, "f5xc-config");
		f5xcProfilesDir = path.join(f5xcConfigDir, "profiles");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ProfileService._resetForTest();
		_resetSettingsForTest();
	});

	it("returns items for each cached profile with apiUrl in description", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_STAGING);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const activate = getProfileSubcommand("activate");
		const items = activate.getArgumentCompletions!("");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["production", "staging"]);
		const prod = items!.find(i => i.label === "production");
		expect(prod?.description).toContain(TEST_PROFILE.apiUrl);
	});

	it("filters case-insensitively by prefix", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_STAGING);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const activate = getProfileSubcommand("activate");
		const items = activate.getArgumentCompletions!("P");
		expect(items?.map(i => i.label)).toEqual(["production"]);
	});

	it("incompatible profile gets 'incompatible: v2' in description", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE_INCOMPATIBLE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const activate = getProfileSubcommand("activate");
		const items = activate.getArgumentCompletions!("");
		expect(items?.[0]?.description).toContain("incompatible: v2");
	});

	it("returns null when no profile name matches", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const activate = getProfileSubcommand("activate");
		expect(activate.getArgumentCompletions!("zz")).toBeNull();
	});

	it("returns null once the prefix contains a space (past-argument boundary)", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const activate = getProfileSubcommand("activate");
		expect(activate.getArgumentCompletions!("production ")).toBeNull();
	});

	it("returns null when ProfileService is not initialized (no throw)", () => {
		// Do NOT call ProfileService.init. tryGetProfileService will see .instance throw.
		const activate = getProfileSubcommand("activate");
		expect(() => activate.getArgumentCompletions!("")).not.toThrow();
		expect(activate.getArgumentCompletions!("")).toBeNull();
	});
});
