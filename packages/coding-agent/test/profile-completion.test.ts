import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { type F5XCProfile, ProfileService } from "@f5xc-salesdemos/xcsh/services/f5xc-profile";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@f5xc-salesdemos/xcsh/slash-commands/builtin-registry";
import {
	TEST_PROFILE,
	TEST_PROFILE_INCOMPATIBLE,
	TEST_PROFILE_STAGING,
	TEST_PROFILE_WITH_ENV,
} from "./f5xc-test-fixtures";

function writeProfile(profilesDir: string, profile: F5XCProfile): void {
	fs.mkdirSync(profilesDir, { recursive: true });
	fs.writeFileSync(path.join(profilesDir, `${profile.name}.json`), JSON.stringify(profile, null, 2), { mode: 0o600 });
}

function writeActiveProfile(configDir: string, name: string): void {
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

describe("/profile unset completion", () => {
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

		testDir = path.join(os.tmpdir(), "test-profile-completion-unset", Snowflake.next());
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

	async function setupWithEnvProfile() {
		writeProfile(f5xcProfilesDir, TEST_PROFILE_WITH_ENV);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE_WITH_ENV.name);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		return service;
	}

	it("returns null when there is no active profile", () => {
		ProfileService.init(f5xcConfigDir); // no loadActive()
		const unset = getProfileSubcommand("unset");
		expect(unset.getArgumentCompletions!("")).toBeNull();
	});

	it("returns all env keys sorted when prefix is empty", async () => {
		await setupWithEnvProfile();
		const unset = getProfileSubcommand("unset");
		const items = unset.getArgumentCompletions!("");
		expect(items).not.toBeNull();
		const keys = [...Object.keys(TEST_PROFILE_WITH_ENV.env)].sort();
		expect(items!.map(i => i.label)).toEqual(keys);
	});

	it("filters case-insensitively by prefix on the last word", async () => {
		await setupWithEnvProfile();
		const unset = getProfileSubcommand("unset");
		const items = unset.getArgumentCompletions!("f5xc_em");
		expect(items?.map(i => i.label)).toEqual(["F5XC_EMAIL"]);
	});

	it("excludes already-typed keys from the dropdown (multi-key flow)", async () => {
		await setupWithEnvProfile();
		const unset = getProfileSubcommand("unset");
		const items = unset.getArgumentCompletions!("F5XC_EMAIL ");
		const labels = items?.map(i => i.label) ?? [];
		expect(labels).not.toContain("F5XC_EMAIL");
		expect(labels.length).toBe(Object.keys(TEST_PROFILE_WITH_ENV.env).length - 1);
	});

	it("mixed-case already-typed keys still excluded from the dropdown (case-insensitive dedup)", async () => {
		await setupWithEnvProfile();
		const unset = getProfileSubcommand("unset");
		// User typed a key in lowercase before hitting tab — the dedup must still
		// recognise it against the uppercase keys returned by getActiveEnvKeys().
		const items = unset.getArgumentCompletions!("f5xc_email ");
		const labels = items?.map(i => i.label) ?? [];
		expect(labels).not.toContain("F5XC_EMAIL");
	});

	it("value for multi-key mode preserves head so infra prepending produces the correct full argument", async () => {
		await setupWithEnvProfile();
		const unset = getProfileSubcommand("unset");
		const items = unset.getArgumentCompletions!("F5XC_EMAIL F");
		const pick = items?.find(i => i.label === "F5XC_USERNAME");
		expect(pick).toBeDefined();
		// Provider-scoped value: "F5XC_EMAIL F5XC_USERNAME ". Infra layer prepends "unset ".
		expect(pick!.value).toBe("F5XC_EMAIL F5XC_USERNAME ");
	});

	it("returns null when every known env key has been typed already", async () => {
		await setupWithEnvProfile();
		const unset = getProfileSubcommand("unset");
		const allKeys = Object.keys(TEST_PROFILE_WITH_ENV.env).join(" ");
		expect(unset.getArgumentCompletions!(`${allKeys} `)).toBeNull();
	});
});

describe("/profile namespace completion", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcProfilesDir: string;
	let projectDir: string;
	let agentDir: string;
	let savedFetch: typeof globalThis.fetch;

	beforeEach(async () => {
		_resetSettingsForTest();
		ProfileService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-profile-completion-ns", Snowflake.next());
		f5xcConfigDir = path.join(testDir, "f5xc-config");
		f5xcProfilesDir = path.join(f5xcConfigDir, "profiles");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
		savedFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = savedFetch;
		fs.rmSync(testDir, { recursive: true, force: true });
		ProfileService._resetForTest();
		_resetSettingsForTest();
	});

	function mockNamespaceFetch(names: string[]): typeof globalThis.fetch {
		const body = JSON.stringify({ items: names.map(n => ({ name: n })) });
		const fn = () =>
			Promise.resolve(
				new Response(body, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		return fn as unknown as typeof globalThis.fetch;
	}

	it("returns null when namespace cache is empty", () => {
		ProfileService.init(f5xcConfigDir);
		const ns = getProfileSubcommand("namespace");
		expect(ns.getArgumentCompletions!("")).toBeNull();
	});

	it("returns cached namespace items with empty prefix", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
		globalThis.fetch = mockNamespaceFetch(["ns1", "ns2", "production"]);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		await service.validateToken({ apiUrl: TEST_PROFILE.apiUrl, apiToken: TEST_PROFILE.apiToken });

		const ns = getProfileSubcommand("namespace");
		const items = ns.getArgumentCompletions!("");
		expect(items?.map(i => i.label)).toEqual(["ns1", "ns2", "production"]);
	});

	it("filters case-insensitively by prefix", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
		globalThis.fetch = mockNamespaceFetch(["ns1", "ns2", "production"]);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		await service.validateToken({ apiUrl: TEST_PROFILE.apiUrl, apiToken: TEST_PROFILE.apiToken });

		const ns = getProfileSubcommand("namespace");
		const items = ns.getArgumentCompletions!("Ns");
		expect(items?.map(i => i.label)).toEqual(["ns1", "ns2"]);
	});

	it("returns null once prefix contains a space (past-argument boundary)", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
		globalThis.fetch = mockNamespaceFetch(["ns1"]);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		await service.validateToken({ apiUrl: TEST_PROFILE.apiUrl, apiToken: TEST_PROFILE.apiToken });

		const ns = getProfileSubcommand("namespace");
		expect(ns.getArgumentCompletions!("ns1 ")).toBeNull();
	});

	it("returns null when prefix matches no cached namespace", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
		globalThis.fetch = mockNamespaceFetch(["ns1", "ns2"]);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		await service.validateToken({ apiUrl: TEST_PROFILE.apiUrl, apiToken: TEST_PROFILE.apiToken });

		const ns = getProfileSubcommand("namespace");
		expect(ns.getArgumentCompletions!("xyz")).toBeNull();
	});

	it("returns null when ProfileService is not initialized (no throw)", () => {
		// Do NOT call ProfileService.init. tryGetProfileService will see .instance throw.
		const ns = getProfileSubcommand("namespace");
		expect(() => ns.getArgumentCompletions!("")).not.toThrow();
		expect(ns.getArgumentCompletions!("")).toBeNull();
	});
});
