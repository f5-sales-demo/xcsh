import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { type F5XCProfile, ProfileError, ProfileService } from "@f5xc-salesdemos/xcsh/services/f5xc-profile";
import {
	TEST_PROFILE as _TEST_PROFILE,
	TEST_PROFILE_STAGING as _TEST_PROFILE_STAGING,
	TEST_PROFILE_INCOMPATIBLE,
	TEST_PROFILE_WITH_ENV,
} from "./f5xc-test-fixtures";

const TEST_PROFILE: F5XCProfile = { ..._TEST_PROFILE };
const TEST_PROFILE_2: F5XCProfile = { ..._TEST_PROFILE_STAGING };
const TEST_PROFILE_ENV: F5XCProfile = { ...TEST_PROFILE_WITH_ENV };
const TEST_PROFILE_INCOMPAT: F5XCProfile = { ...TEST_PROFILE_INCOMPATIBLE };

function writeProfile(profilesDir: string, profile: F5XCProfile): void {
	fs.mkdirSync(profilesDir, { recursive: true });
	fs.writeFileSync(path.join(profilesDir, `${profile.name}.json`), JSON.stringify(profile, null, 2), { mode: 0o600 });
}

function writeActiveProfile(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_profile"), name, { mode: 0o644 });
}

describe("ProfileService", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcProfilesDir: string;
	let projectDir: string;
	let agentDir: string;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ProfileService._resetForTest();
		// Save and delete ALL F5XC_* env vars to prevent container env leakage
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) {
				savedEnv[key] = process.env[key];
				delete process.env[key];
			}
		}
		savedEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-f5xc-profile", Snowflake.next());
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
		_resetSettingsForTest();
		ProfileService._resetForTest();
		// Restore ALL F5XC_* env vars
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) process.env[key] = value;
		}
		delete process.env.XDG_CONFIG_HOME;
		if (savedEnv.XDG_CONFIG_HOME !== undefined) {
			process.env.XDG_CONFIG_HOME = savedEnv.XDG_CONFIG_HOME;
		}
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe("loadActive", () => {
		it("returns null when config dir does not exist", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
		});

		it("returns null when active_profile file is missing", async () => {
			fs.mkdirSync(f5xcConfigDir, { recursive: true });
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
		});

		it("returns profile when valid active_profile and JSON exist", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.name).toBe(TEST_PROFILE.name);
			expect(result?.apiUrl).toBe(TEST_PROFILE.apiUrl);
			expect(result?.apiToken).toBe(TEST_PROFILE.apiToken);
		});

		it("injects credentials into bash.environment settings override", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_API_URL).toBe(TEST_PROFILE.apiUrl);
			expect(bashEnv.F5XC_API_TOKEN).toBe(TEST_PROFILE.apiToken);
			expect(bashEnv.F5XC_NAMESPACE).toBe(TEST_PROFILE.defaultNamespace);
		});

		it("returns null when F5XC_API_URL is set (env override skips profile)", async () => {
			process.env.F5XC_API_URL = "https://env-override.console.ves.volterra.io";
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
			expect(service.getStatus().credentialSource).toBe("environment");
		});

		it("loads profile values into bash.environment (env vars inherited separately via process.env)", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_API_URL).toBe(TEST_PROFILE.apiUrl);
			expect(bashEnv.F5XC_API_TOKEN).toBe(TEST_PROFILE.apiToken);
			expect(bashEnv.F5XC_NAMESPACE).toBe(TEST_PROFILE.defaultNamespace);
		});

		it("auto-activates the single profile when no active_profile exists", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			// No active_profile file

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.name).toBe(TEST_PROFILE.name);

			// Should have written active_profile
			const written = fs.readFileSync(path.join(f5xcConfigDir, "active_profile"), "utf-8");
			expect(written).toBe(TEST_PROFILE.name);
		});

		it("does not auto-activate when multiple profiles exist", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			// No active_profile file

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("returns null gracefully on invalid JSON", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(path.join(f5xcProfilesDir, "broken.json"), "not json{{{");
			writeActiveProfile(f5xcConfigDir, "broken");

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("rejects profile with non-string field types", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "bad-types.json"),
				JSON.stringify({ apiUrl: 123, apiToken: true, defaultNamespace: {} }),
			);
			writeActiveProfile(f5xcConfigDir, "bad-types");

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("uses filename as profile name, ignoring parsed.name", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "my-file.json"),
				JSON.stringify({
					name: "different-name",
					apiUrl: "https://test.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
				}),
			);
			writeActiveProfile(f5xcConfigDir, "my-file");

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.name).toBe("my-file");
		});

		it("does not write active_profile when auto-activated profile is invalid", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(path.join(f5xcProfilesDir, "bad.json"), "not valid json{{{");
			// No active_profile file, one broken profile

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
			// active_profile should NOT have been written
			expect(fs.existsSync(path.join(f5xcConfigDir, "active_profile"))).toBe(false);
		});

		it("T-005: returns null when active_profile references non-existent JSON", async () => {
			fs.mkdirSync(f5xcConfigDir, { recursive: true });
			// active_profile points to a profile that doesn't exist
			writeActiveProfile(f5xcConfigDir, "vanished");

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
			expect(service.getStatus().credentialSource).toBe("none");
			// No F5XC vars should be in bash.environment
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_API_URL).toBeUndefined();
		});

		it("per-field env merge: F5XC_API_TOKEN in env skips token injection", async () => {
			process.env.F5XC_API_TOKEN = "env-token-override";
			// F5XC_API_URL is NOT set — profile should load
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// URL should be injected from profile (not in process.env)
			expect(bashEnv.F5XC_API_URL).toBe(TEST_PROFILE.apiUrl);
			// Token should NOT be injected (already in process.env)
			expect(bashEnv.F5XC_API_TOKEN).toBeUndefined();
			// Namespace should be injected from profile
			expect(bashEnv.F5XC_NAMESPACE).toBe(TEST_PROFILE.defaultNamespace);
		});

		it("rejects active_profile with path traversal content", async () => {
			fs.mkdirSync(f5xcConfigDir, { recursive: true });
			writeActiveProfile(f5xcConfigDir, "../../etc/shadow");

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("returns null gracefully when profile missing required fields", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(path.join(f5xcProfilesDir, "incomplete.json"), JSON.stringify({ name: "incomplete" }));
			writeActiveProfile(f5xcConfigDir, "incomplete");

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});
	});

	describe("listProfiles", () => {
		it("returns all profiles from profiles directory", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);

			const service = ProfileService.init(f5xcConfigDir);
			const profiles = await service.listProfiles();

			expect(profiles.length).toBe(2);
			const names = profiles.map(p => p.name).sort();
			expect(names).toEqual(["production", "staging"]);
		});

		it("returns empty array when profiles directory does not exist", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			const profiles = await service.listProfiles();
			expect(profiles).toEqual([]);
		});
	});

	describe("activate", () => {
		it("reads profile, writes active_profile, and updates settings", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const result = await service.activate(TEST_PROFILE_2.name);
			expect(result.name).toBe(TEST_PROFILE_2.name);

			// active_profile file should be updated
			const written = fs.readFileSync(path.join(f5xcConfigDir, "active_profile"), "utf-8");
			expect(written).toBe(TEST_PROFILE_2.name);

			// settings should reflect new profile
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_API_URL).toBe(TEST_PROFILE_2.apiUrl);
		});

		it("rejects profile names with path separators", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.activate("../../etc/passwd")).rejects.toThrow(/Invalid profile name/);
			await expect(service.activate("../escape")).rejects.toThrow(/Invalid profile name/);
			await expect(service.activate("sub/dir")).rejects.toThrow(/Invalid profile name/);
			await expect(service.activate("has..dots")).rejects.toThrow(/Invalid profile name/);
		});

		it("throws ProfileError when profile does not exist", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });

			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.activate("nonexistent")).rejects.toThrow(ProfileError);
		});

		it("T-017: does not update active_profile when profile JSON is missing", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			// Try to activate a profile that doesn't exist
			await expect(service.activate("missing")).rejects.toThrow(ProfileError);

			// active_profile should still point to original profile
			const active = fs.readFileSync(path.join(f5xcConfigDir, "active_profile"), "utf-8");
			expect(active).toBe(TEST_PROFILE.name);
		});

		it("rejects activation when F5XC_API_URL is in environment", async () => {
			process.env.F5XC_API_URL = "https://env.console.ves.volterra.io";
			writeProfile(f5xcProfilesDir, TEST_PROFILE);

			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.activate(TEST_PROFILE.name)).rejects.toThrow(/Cannot activate/);
		});

		it("rejects empty profile name", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.activate("")).rejects.toThrow(/Invalid profile name/);
		});

		it("rejects activation when F5XC_API_URL set — error cites unset command", async () => {
			process.env.F5XC_API_URL = "https://env.console.ves.volterra.io";
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			const service = ProfileService.init(f5xcConfigDir);
			const err = await service.activate(TEST_PROFILE.name).catch(e => e);
			expect(err.message).toContain("unset F5XC_API_URL");
			expect(err.message).not.toContain("/profile env");
		});

		it("profile not found error cites /profile list", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			const service = ProfileService.init(f5xcConfigDir);
			const err = await service.activate("ghost").catch(e => e);
			expect(err.message).toContain("ghost");
			expect(err.message).toContain("/profile list");
		});
	});

	describe("setNamespace", () => {
		it("setNamespace error cites /profile activate", () => {
			const service = ProfileService.init(f5xcConfigDir);
			let err: Error | null = null;
			try {
				service.setNamespace("ns");
			} catch (e) {
				err = e as Error;
			}
			expect(err?.message).toContain("/profile activate");
		});
	});

	describe("getStatus", () => {
		it("returns correct state after loadActive", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const status = service.getStatus();
			expect(status.activeProfileName).toBe(TEST_PROFILE.name);
			expect(status.activeProfileUrl).toBe(TEST_PROFILE.apiUrl);
			expect(status.credentialSource).toBe("profile");
			expect(status.isConfigured).toBe(true);
		});

		it("returns none state when no profile loaded", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			const status = service.getStatus();
			expect(status.activeProfileName).toBeNull();
			expect(status.credentialSource).toBe("none");
			expect(status.isConfigured).toBe(false);
		});

		it("reports environment source when all env vars are set", async () => {
			process.env.F5XC_API_URL = "https://env.console.ves.volterra.io";
			process.env.F5XC_API_TOKEN = "env-token-value";

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const status = service.getStatus();
			expect(status.credentialSource).toBe("environment");
		});

		it("loads profile normally when only F5XC_API_TOKEN is set (not URL)", async () => {
			process.env.F5XC_API_TOKEN = "env-token-only";
			// F5XC_API_URL not set — profile should load; env token inherited by subprocess via process.env
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			// Mixed: URL from profile, token from env
			expect(service.getStatus().credentialSource).toBe("mixed");
		});

		it("reports mixed source when F5XC_NAMESPACE is in env but rest from profile", async () => {
			process.env.F5XC_NAMESPACE = "env-namespace";
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			expect(service.getStatus().credentialSource).toBe("mixed");
		});
	});

	describe("createProfile", () => {
		it("creates profile JSON file with correct content", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await service.createProfile({
				name: "new-prof",
				apiUrl: "https://new.console.ves.volterra.io",
				apiToken: "tok-create-test",
				defaultNamespace: "ns1",
			});

			const filePath = path.join(f5xcProfilesDir, "new-prof.json");
			expect(fs.existsSync(filePath)).toBe(true);
			const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			expect(data.apiUrl).toBe("https://new.console.ves.volterra.io");
			expect(data.apiToken).toBe("tok-create-test");
			expect(data.defaultNamespace).toBe("ns1");
			expect(data.metadata?.createdAt).toBeDefined();
			// createdAt should be a valid ISO date string
			expect(Number.isNaN(Date.parse(data.metadata.createdAt))).toBe(false);
		});

		it("creates profiles directory if it does not exist", async () => {
			expect(fs.existsSync(f5xcProfilesDir)).toBe(false);

			const service = ProfileService.init(f5xcConfigDir);
			await service.createProfile({
				name: "first",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			expect(fs.existsSync(f5xcProfilesDir)).toBe(true);
		});

		it("writes profile file with 0o600 permissions", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await service.createProfile({
				name: "perms-test",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			const stat = fs.statSync(path.join(f5xcProfilesDir, "perms-test.json"));
			expect(stat.mode & 0o777).toBe(0o600);
		});

		it("rejects duplicate profile name", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);

			const service = ProfileService.init(f5xcConfigDir);
			await expect(
				service.createProfile({
					name: TEST_PROFILE.name,
					apiUrl: "https://x.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
				}),
			).rejects.toThrow(/already exists/);
		});

		it("rejects profile name with path traversal", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(
				service.createProfile({
					name: "../../etc/passwd",
					apiUrl: "https://x.io",
					apiToken: "t",
					defaultNamespace: "d",
				}),
			).rejects.toThrow(/Invalid profile name/);
		});

		it("rejects empty profile name", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(
				service.createProfile({ name: "", apiUrl: "https://x.io", apiToken: "t", defaultNamespace: "d" }),
			).rejects.toThrow(/Invalid profile name/);
		});

		it("rejects profile name longer than 64 chars", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(
				service.createProfile({
					name: "a".repeat(65),
					apiUrl: "https://x.io",
					apiToken: "t",
					defaultNamespace: "d",
				}),
			).rejects.toThrow(/Invalid profile name/);
		});

		it("uses atomic write (no .tmp file remains after success)", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await service.createProfile({
				name: "atomic-test",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			expect(fs.existsSync(path.join(f5xcProfilesDir, "atomic-test.json"))).toBe(true);
			expect(fs.existsSync(path.join(f5xcProfilesDir, "atomic-test.json.tmp"))).toBe(false);
		});
	});

	describe("deleteProfile", () => {
		it("deletes existing profile JSON file", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			const filePath = path.join(f5xcProfilesDir, `${TEST_PROFILE_2.name}.json`);
			expect(fs.existsSync(filePath)).toBe(true);

			const service = ProfileService.init(f5xcConfigDir);
			await service.deleteProfile(TEST_PROFILE_2.name);

			expect(fs.existsSync(filePath)).toBe(false);
		});

		it("throws ProfileError for non-existent profile", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.deleteProfile("ghost")).rejects.toThrow(/not found/);
		});

		it("rejects profile name with path traversal", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.deleteProfile("../escape")).rejects.toThrow(/Invalid profile name/);
		});

		it("rejects empty profile name", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.deleteProfile("")).rejects.toThrow(/Invalid profile name/);
		});

		it("does not affect active_profile file", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.deleteProfile(TEST_PROFILE_2.name);

			// active_profile still points to production
			const active = fs.readFileSync(path.join(f5xcConfigDir, "active_profile"), "utf-8");
			expect(active).toBe(TEST_PROFILE.name);
		});
	});

	describe("env map and tenant derivation", () => {
		it("loadActive injects env map vars into bash.environment", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE_ENV);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE_ENV.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_EMAIL).toBe("test@example.com");
			expect(bashEnv.F5XC_USERNAME).toBe("testuser@example.com");
			expect(bashEnv.F5XC_CONSOLE_PASSWORD).toBe("test-console-pass");
			expect(bashEnv.F5XC_LB_NAME).toBe("test-lb");
			expect(bashEnv.F5XC_DOMAINNAME).toBe("test.example.com");
			expect(bashEnv.F5XC_ROOT_DOMAIN).toBe("example.com");
		});

		it("F5XC_TENANT is auto-derived from apiUrl hostname", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// TEST_F5XC_URL is https://test-tenant.console.ves.volterra.io
			expect(bashEnv.F5XC_TENANT).toBe("test-tenant");
		});

		it("env map vars respect per-field process.env precedence", async () => {
			process.env.F5XC_EMAIL = "env-email@override.com";
			writeProfile(f5xcProfilesDir, TEST_PROFILE_ENV);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE_ENV.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// F5XC_EMAIL is in process.env — should NOT be overridden
			expect(bashEnv.F5XC_EMAIL).toBeUndefined();
			// Other env vars should be injected normally
			expect(bashEnv.F5XC_LB_NAME).toBe("test-lb");

			delete process.env.F5XC_EMAIL;
		});

		it("createProfile stores env map in JSON", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await service.createProfile({
				name: "with-env",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
				env: { F5XC_LB_NAME: "my-lb", F5XC_EMAIL: "a@b.com" },
			});

			const data = JSON.parse(fs.readFileSync(path.join(f5xcProfilesDir, "with-env.json"), "utf-8"));
			expect(data.env.F5XC_LB_NAME).toBe("my-lb");
			expect(data.env.F5XC_EMAIL).toBe("a@b.com");
		});

		it("getStatus includes tenant and namespace", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const status = service.getStatus();
			expect(status.activeProfileTenant).toBe("test-tenant");
			expect(status.activeProfileNamespace).toBe(TEST_PROFILE.defaultNamespace);
		});

		it("profile switch clears stale F5XC_* vars from previous profile", async () => {
			// Production has F5XC_CONSOLE_PASSWORD in env map, staging does not
			const prodWithPass: F5XCProfile = {
				...TEST_PROFILE,
				env: { F5XC_CONSOLE_PASSWORD: "secret-pass", F5XC_LB_NAME: "prod-lb" },
			};
			const stagingNoPass: F5XCProfile = {
				...TEST_PROFILE_2,
				env: { F5XC_LB_NAME: "staging-lb" },
			};
			writeProfile(f5xcProfilesDir, prodWithPass);
			writeProfile(f5xcProfilesDir, stagingNoPass);
			writeActiveProfile(f5xcConfigDir, prodWithPass.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			// Verify production password is present
			let bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_CONSOLE_PASSWORD).toBe("secret-pass");
			expect(bashEnv.F5XC_LB_NAME).toBe("prod-lb");

			// Switch to staging — password must be CLEARED
			await service.activate(stagingNoPass.name);
			bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_CONSOLE_PASSWORD).toBeUndefined();
			expect(bashEnv.F5XC_LB_NAME).toBe("staging-lb");
		});

		it("setNamespace switches namespace in active profile", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			expect(service.getStatus().activeProfileNamespace).toBe(TEST_PROFILE.defaultNamespace);

			service.setNamespace("other-ns");

			expect(service.getStatus().activeProfileNamespace).toBe("other-ns");
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_NAMESPACE).toBe("other-ns");
		});

		it("setNamespace throws when no active profile", () => {
			const service = ProfileService.init(f5xcConfigDir);
			expect(() => service.setNamespace("test")).toThrow(/No active profile/);
		});

		it("profiles without env field work unchanged (backward compat)", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.env).toBeUndefined();
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.F5XC_API_URL).toBe(TEST_PROFILE.apiUrl);
			expect(bashEnv.F5XC_TENANT).toBe("test-tenant");
		});
	});

	describe("maskToken", () => {
		it("masks all but last 4 characters", () => {
			const service = ProfileService.init(f5xcConfigDir);
			expect(service.maskToken(_TEST_PROFILE.apiToken)).toBe(`...${_TEST_PROFILE.apiToken.slice(-4)}`);
		});

		it("masks short tokens completely", () => {
			const service = ProfileService.init(f5xcConfigDir);
			expect(service.maskToken("abc")).toBe("****");
		});
	});

	describe("getOrInit", () => {
		it("returns the existing instance when already initialized", async () => {
			const first = ProfileService.init(f5xcConfigDir);
			const second = await ProfileService.getOrInit(f5xcConfigDir);
			expect(second).toBe(first);
		});

		it("bootstraps with the provided configDir when no instance exists", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = await ProfileService.getOrInit(f5xcConfigDir);
			expect(service.profilesDir).toBe(f5xcProfilesDir);
			expect(service.getStatus().activeProfileName).toBe(TEST_PROFILE.name);
		});

		it("falls back to getF5XCConfigDir() when configDir is omitted", async () => {
			process.env.XDG_CONFIG_HOME = testDir;
			const service = await ProfileService.getOrInit();
			expect(service.profilesDir.startsWith(testDir)).toBe(true);
		});

		it("is idempotent under concurrent callers", async () => {
			const [a, b] = await Promise.all([
				ProfileService.getOrInit(f5xcConfigDir),
				ProfileService.getOrInit(f5xcConfigDir),
			]);
			expect(a).toBe(b);
		});
	});

	describe("schema version", () => {
		it("createProfile writes version: 1 to disk", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await service.createProfile({
				name: "versioned",
				apiUrl: "https://example.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});
			const raw = JSON.parse(fs.readFileSync(path.join(f5xcProfilesDir, "versioned.json"), "utf-8"));
			expect(raw.version).toBe(1);
		});

		it("reading a legacy profile (no version field) succeeds", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "legacy.json"),
				JSON.stringify(
					{
						name: "legacy",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			writeActiveProfile(f5xcConfigDir, "legacy");
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();
			expect(result).not.toBeNull();
			expect((result as F5XCProfile).version).toBeUndefined();
		});

		it("reading a v1 profile succeeds", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "v1.json"),
				JSON.stringify(
					{
						name: "v1",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 1,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			writeActiveProfile(f5xcConfigDir, "v1");
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();
			expect(result).not.toBeNull();
			expect((result as F5XCProfile).version).toBe(1);
		});

		it("activate() rejects a v2 profile with actionable error", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "future.json"),
				JSON.stringify(
					{
						name: "future",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 2,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.activate("future")).rejects.toThrow(/schema version 2/);
			await expect(service.activate("future")).rejects.toThrow(/upgrade xcsh/i);
		});

		it("loadActive() returns null for a v2 profile — does not crash startup", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "future.json"),
				JSON.stringify(
					{
						name: "future",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 2,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			writeActiveProfile(f5xcConfigDir, "future");
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
		});

		it("loadActive() does NOT persist auto-activate for an incompatible profile", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "future.json"),
				JSON.stringify(
					{
						name: "future",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 2,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			// No active_profile file — triggers auto-activate path
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
			expect(fs.existsSync(path.join(f5xcConfigDir, "active_profile"))).toBe(false);
		});

		it("setEnvVars() rejects a v2 profile before write-back", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "future.json"),
				JSON.stringify(
					{
						name: "future",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 2,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.setEnvVars("future", { MY_KEY: "val" })).rejects.toThrow(/schema version 2/);
		});

		it("unsetEnvVars() rejects a v2 profile before write-back", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "future.json"),
				JSON.stringify(
					{
						name: "future",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 2,
						env: { MY_KEY: "val" },
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.unsetEnvVars("future", ["MY_KEY"])).rejects.toThrow(/schema version 2/);
		});

		it("listProfiles() includes incompatible profiles (no gate)", async () => {
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "future.json"),
				JSON.stringify(
					{
						name: "future",
						apiUrl: "https://example.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "default",
						version: 2,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			const service = ProfileService.init(f5xcConfigDir);
			const profiles = await service.listProfiles();
			expect(profiles.length).toBe(1);
			expect(profiles[0].version).toBe(2);
		});
	});

	describe("validateToken", () => {
		let savedFetch: typeof globalThis.fetch;

		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});

		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function makeMockResponse(status: number): typeof globalThis.fetch {
			const fn = () => Promise.resolve(new Response(status === 200 ? "ok" : "err", { status }));
			return fn as unknown as typeof globalThis.fetch;
		}

		function makeNetworkError(): typeof globalThis.fetch {
			const fn = () => Promise.reject(new Error("network failure"));
			return fn as unknown as typeof globalThis.fetch;
		}

		it("200 response returns connected with latencyMs, no errorClass", async () => {
			globalThis.fetch = makeMockResponse(200);
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("connected");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBeUndefined();
		});

		it("401 response returns auth_error with errorClass: credential", async () => {
			globalThis.fetch = makeMockResponse(401);
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("auth_error");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("credential");
		});

		it("403 response returns auth_error with errorClass: credential", async () => {
			globalThis.fetch = makeMockResponse(403);
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("auth_error");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("credential");
		});

		it("500 response returns offline with errorClass: network and latencyMs (was 'connected')", async () => {
			globalThis.fetch = makeMockResponse(500);
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("network");
		});

		it("502 response returns offline with errorClass: network (was 'connected')", async () => {
			globalThis.fetch = makeMockResponse(502);
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("network");
		});

		it("429 response returns offline with errorClass: network", async () => {
			globalThis.fetch = makeMockResponse(429);
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("network");
		});

		it("network error returns offline with errorClass: network, no latencyMs", async () => {
			globalThis.fetch = makeNetworkError();
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeUndefined();
			expect(result.errorClass).toBe("network");
		});

		it("missing credentials returns unknown with no errorClass", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			const result = await service.validateToken({});
			expect(result.status).toBe("unknown");
			expect(result.errorClass).toBeUndefined();
		});
	});

	describe("validateProfileByName", () => {
		let savedFetch: typeof globalThis.fetch;

		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});

		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function makeMockResponse(status: number): typeof globalThis.fetch {
			const fn = () => Promise.resolve(new Response(status === 200 ? "ok" : "err", { status }));
			return fn as unknown as typeof globalThis.fetch;
		}

		it("returns connected status for a valid profile", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			globalThis.fetch = makeMockResponse(200);
			const service = ProfileService.init(f5xcConfigDir);
			await service.listProfiles();

			const result = await service.validateProfileByName(TEST_PROFILE.name);
			expect(result.profile.name).toBe(TEST_PROFILE.name);
			expect(result.status).toBe("connected");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBeUndefined();
		});

		it("returns auth_error with credential errorClass on 401", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			globalThis.fetch = makeMockResponse(401);
			const service = ProfileService.init(f5xcConfigDir);

			const result = await service.validateProfileByName(TEST_PROFILE.name);
			expect(result.status).toBe("auth_error");
			expect(result.errorClass).toBe("credential");
		});

		it("throws ProfileError for invalid profile name", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.validateProfileByName("bad name!")).rejects.toThrow(ProfileError);
		});

		it("throws ProfileError for missing profile", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.validateProfileByName("nonexistent")).rejects.toThrow(/not found/);
		});

		it("throws ProfileError for incompatible schema version", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE_INCOMPAT);
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.validateProfileByName(TEST_PROFILE_INCOMPAT.name)).rejects.toThrow(/schema version/);
		});

		it("does not mutate cached auth state when validating a non-active profile", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			globalThis.fetch = makeMockResponse(200);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			await service.validateToken();
			const before = service.getStatus();

			globalThis.fetch = makeMockResponse(401);
			await service.validateProfileByName(TEST_PROFILE_2.name);

			const after = service.getStatus();
			expect(after.authStatus).toBe(before.authStatus);
			expect(after.authCheckedAt).toBe(before.authCheckedAt);
			expect(after.authLatencyMs).toBe(before.authLatencyMs);
		});
	});

	describe("getActiveEnvKeys", () => {
		it("returns [] when no active profile", () => {
			const service = ProfileService.init(f5xcConfigDir);
			expect(service.getActiveEnvKeys()).toEqual([]);
		});

		it("returns sorted keys from active profile's env record", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE_ENV);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE_ENV.name);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			const keys = service.getActiveEnvKeys();
			expect(keys).toEqual(Object.keys(TEST_PROFILE_WITH_ENV.env).sort());
		});
	});

	describe("profiles cache (listProfileNamesCached + getProfileHint)", () => {
		it("listProfileNamesCached returns [] between init() and loadActive()", () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			const service = ProfileService.init(f5xcConfigDir);
			expect(service.listProfileNamesCached()).toEqual([]);
		});

		it("populates from loadActive() and returns sorted names", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE); // "production"
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2); // "staging"
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			expect(service.listProfileNamesCached()).toEqual(["production", "staging"]);
		});

		it("refreshes cache when listProfiles() is called again after a direct filesystem change", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			expect(service.listProfileNamesCached()).toEqual(["production"]);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2); // simulate sibling-process add
			await service.listProfiles(); // cache updates via this call
			expect(service.listProfileNamesCached()).toEqual(["production", "staging"]);
		});

		it("createProfile updates cache in place", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await service.createProfile(TEST_PROFILE_2);
			expect(service.listProfileNamesCached()).toEqual(["production", "staging"]);
		});

		it("deleteProfile removes from cache", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await service.deleteProfile("staging");
			expect(service.listProfileNamesCached()).toEqual(["production"]);
		});

		it("getProfileHint returns null for unknown name", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			expect(service.getProfileHint("nope")).toBeNull();
		});

		it("getProfileHint returns apiUrl and incompatible=false for compatible profile", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			const hint = service.getProfileHint("production");
			expect(hint).not.toBeNull();
			expect(hint!.apiUrl).toBe(TEST_PROFILE.apiUrl);
			expect(hint!.incompatible).toBe(false);
			expect("schemaVersion" in hint!).toBe(false);
		});

		it("getProfileHint returns incompatible=true and schemaVersion for schema v2 profile", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE_INCOMPAT);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			const hint = service.getProfileHint(TEST_PROFILE_INCOMPAT.name);
			expect(hint).not.toBeNull();
			expect(hint!.incompatible).toBe(true);
			expect(hint!.schemaVersion).toBe(2);
		});

		it("listProfiles skips files whose basename fails the profile-name regex", async () => {
			// A well-formed profile that will be listed.
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			// A stray file (copied/synced manually) whose basename has a space — can
			// never be activated because #validateProfileName would reject it, so
			// /profile list and /profile activate <tab> must also hide it.
			fs.mkdirSync(f5xcProfilesDir, { recursive: true });
			fs.writeFileSync(
				path.join(f5xcProfilesDir, "bad name.json"),
				JSON.stringify({
					apiUrl: TEST_PROFILE.apiUrl,
					apiToken: TEST_PROFILE.apiToken,
					defaultNamespace: "default",
				}),
				{ mode: 0o600 },
			);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const names = service.listProfileNamesCached();
			expect(names).toContain(TEST_PROFILE.name);
			expect(names).not.toContain("bad name");
			const listed = await service.listProfiles();
			expect(listed.map(p => p.name)).not.toContain("bad name");
		});
	});

	describe("namespace cache", () => {
		let savedFetch: typeof globalThis.fetch;
		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});
		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function makeMockJsonResponse(status: number, body: unknown): typeof globalThis.fetch {
			const fn = () =>
				Promise.resolve(
					new Response(JSON.stringify(body), {
						status,
						headers: { "Content-Type": "application/json" },
					}),
				);
			return fn as unknown as typeof globalThis.fetch;
		}
		function makeMockTextResponse(status: number, body = "err"): typeof globalThis.fetch {
			const fn = () => Promise.resolve(new Response(body, { status }));
			return fn as unknown as typeof globalThis.fetch;
		}

		// validateToken's cache population is fire-and-forget (body parse runs off the
		// hot path). Tests must yield to the microtask queue before asserting cache state.
		function waitForCachePopulate(): Promise<void> {
			return new Promise(resolve => setTimeout(resolve, 10));
		}

		async function setupActiveProfile(): Promise<ProfileService> {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			return service;
		}

		it("getCachedNamespaces returns [] before any validateToken call", () => {
			const service = ProfileService.init(f5xcConfigDir);
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("validateToken for active profile populates namespace cache sorted by name", async () => {
			globalThis.fetch = makeMockJsonResponse(200, {
				items: [{ name: "production" }, { name: "default" }, { name: "shared" }],
			});
			const service = await setupActiveProfile();
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["default", "production", "shared"]);
		});

		it("validateToken with explicit creds for a NON-active profile does NOT populate cache (prevents /profile show <other> tenant leakage)", async () => {
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "staging-ns" }] });
			const service = await setupActiveProfile();
			// Simulate handleShow probing another profile's credentials — cache must
			// remain scoped to the active profile.
			await service.validateToken({ apiUrl: "https://other.console.ves.volterra.io", apiToken: "other-tok" });
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("validateToken with explicit creds MATCHING the active profile DOES populate cache (activate → handleShow flow)", async () => {
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }, { name: "ns2" }] });
			const service = await setupActiveProfile();
			// handleActivate calls activate() (clears cache) and then handleShow(), which
			// always passes explicit creds. When those creds match the active profile,
			// the cache must warm — otherwise /profile namespace <tab> would be empty
			// immediately after activation until some other path fires validateToken().
			await service.validateToken({ apiUrl: TEST_PROFILE.apiUrl, apiToken: TEST_PROFILE.apiToken });
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1", "ns2"]);
		});

		it("env override (F5XC_API_TOKEN) alongside an active profile does NOT populate cache", async () => {
			// Active profile is loaded normally, then F5XC_API_TOKEN is set to override
			// the profile's token at validateToken time. The fetch hits the active
			// tenant URL but with a different account's credentials, so the returned
			// namespace list reflects a different account than /profile namespace
			// would mutate. The cache must stay empty.
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "env-token-account-ns" }] });
			const service = await setupActiveProfile();
			try {
				process.env.F5XC_API_TOKEN = "different-account-token";
				await service.validateToken();
				await waitForCachePopulate();
				expect(service.getCachedNamespaces()).toEqual([]);
			} finally {
				delete process.env.F5XC_API_TOKEN;
			}
		});

		it("env override alongside activate→handleShow's explicit-creds path does NOT populate cache", async () => {
			// /profile activate calls activate() then handleShow() which passes the
			// profile's own apiUrl/apiToken as explicit options. With F5XC_API_TOKEN
			// also set, the effective comparison would pass (options override env in
			// effectiveToken computation), but the session remains mixed-source — the
			// namespace list returned for the profile's token doesn't match what the
			// user's actual operational calls will see under the env override token.
			// !hasEnvOverride() catches this case.
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "profile-account-ns" }] });
			const service = await setupActiveProfile();
			try {
				process.env.F5XC_API_TOKEN = "env-override-token";
				// Simulate handleShow's explicit-creds call for the active profile.
				await service.validateToken({ apiUrl: TEST_PROFILE.apiUrl, apiToken: TEST_PROFILE.apiToken });
				await waitForCachePopulate();
				expect(service.getCachedNamespaces()).toEqual([]);
			} finally {
				delete process.env.F5XC_API_TOKEN;
			}
		});

		it("stale in-flight namespace response is discarded when activate() intervenes", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			// Build a fetch mock whose body resolution we hold until after activate() runs.
			let releaseBody: (body: unknown) => void = () => {};
			const bodyPromise = new Promise<unknown>(resolve => {
				releaseBody = resolve;
			});
			globalThis.fetch = (() =>
				Promise.resolve({
					ok: true,
					status: 200,
					json: () => bodyPromise,
				} as unknown as Response)) as unknown as typeof globalThis.fetch;

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			// validateToken returns on headers; the fire-and-forget body parse is now stalled.
			await service.validateToken();

			// Activate a different profile — clears the cache AND advances the epoch.
			await service.activate(TEST_PROFILE_2.name);
			expect(service.getCachedNamespaces()).toEqual([]);

			// Release the stalled body with the first profile's namespaces. The .then()
			// callback captured the prior epoch and must now discard the write.
			releaseBody({ items: [{ name: "stale-from-prior-profile" }] });
			await waitForCachePopulate();

			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("validateToken in an env-backed session (no active profile) does NOT populate cache", async () => {
			// No loadActive or activate — service has no active profile.
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }] });
			const service = ProfileService.init(f5xcConfigDir);
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("validateToken 5xx response leaves cache unchanged", async () => {
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }] });
			const service = await setupActiveProfile();
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);
			globalThis.fetch = makeMockTextResponse(502);
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]); // unchanged
		});

		it("validateToken 2xx with malformed body (items is not an array) leaves cache unchanged", async () => {
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }] });
			const service = await setupActiveProfile();
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);

			globalThis.fetch = makeMockJsonResponse(200, { items: "not-an-array" });
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]); // unchanged
		});

		it("validateToken 2xx with non-JSON body leaves cache unchanged (proxy interception case)", async () => {
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }] });
			const service = await setupActiveProfile();
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);

			globalThis.fetch = makeMockTextResponse(200);
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]); // unchanged — response.json() threw, catch swallowed
		});

		it("activate(otherProfile) clears the namespace cache", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }, { name: "ns2" }] });
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1", "ns2"]);

			await service.activate(TEST_PROFILE_2.name);
			expect(service.getCachedNamespaces()).toEqual([]);
		});
	});

	describe("ProfileService.validateToken auth freshness cache", () => {
		let savedFetch: typeof globalThis.fetch;

		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});

		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function makeMockResponse(status: number): typeof globalThis.fetch {
			const fn = () => Promise.resolve(new Response(status === 200 ? "ok" : "err", { status }));
			return fn as unknown as typeof globalThis.fetch;
		}

		function makeNetworkError(): typeof globalThis.fetch {
			const fn = () => Promise.reject(new Error("network failure"));
			return fn as unknown as typeof globalThis.fetch;
		}

		// Helper: set up a service with TEST_PROFILE as the active profile, ready for
		// active-mode validateToken() calls that populate cache. Ad-hoc mode (validateToken with
		// explicit apiUrl/apiToken args) deliberately does NOT touch cache — see the dedicated
		// ad-hoc test below.
		async function activeProfileService(): Promise<ProfileService> {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			return service;
		}

		it("populates authLatencyMs and authCheckedAt on a successful validation", async () => {
			globalThis.fetch = makeMockResponse(200);
			const service = await activeProfileService();

			const before = Date.now();
			await service.validateToken();
			const after = Date.now();

			const status = service.getStatus();
			expect(typeof status.authLatencyMs).toBe("number");
			expect(status.authLatencyMs).toBeGreaterThanOrEqual(0);
			expect(typeof status.authCheckedAt).toBe("number");
			expect(status.authCheckedAt).toBeGreaterThanOrEqual(before);
			expect(status.authCheckedAt).toBeLessThanOrEqual(after);
		});

		it("populates both fields even on a failed validation", async () => {
			globalThis.fetch = makeNetworkError();
			const service = await activeProfileService();

			const before = Date.now();
			await service.validateToken().catch(() => {});
			const after = Date.now();

			const status = service.getStatus();
			expect(typeof status.authLatencyMs).toBe("number");
			expect(status.authLatencyMs).toBeGreaterThanOrEqual(0);
			expect(typeof status.authCheckedAt).toBe("number");
			expect(status.authCheckedAt).toBeGreaterThanOrEqual(before);
			expect(status.authCheckedAt).toBeLessThanOrEqual(after);
		});

		it("stores authCheckedAt as epoch number, not ISO string", async () => {
			globalThis.fetch = makeMockResponse(200);
			const service = await activeProfileService();

			await service.validateToken();

			const status = service.getStatus();
			expect(typeof status.authCheckedAt).toBe("number");
			expect(Number.isInteger(status.authCheckedAt)).toBe(true);
		});

		it("invalidates the auth-freshness cache on profile switch", async () => {
			// Arrange: two profiles, activate the first, run a successful validateToken to populate the cache.
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			globalThis.fetch = makeMockResponse(200);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await service.validateToken();

			const before = service.getStatus();
			expect(before.authStatus).toBe("connected");
			expect(typeof before.authLatencyMs).toBe("number");
			expect(typeof before.authCheckedAt).toBe("number");

			// Act: switch to the second profile. Do not re-validate.
			await service.activate(TEST_PROFILE_2.name);

			// Assert: cache fields cleared; auth status resets to unknown until the next validateToken.
			const after = service.getStatus();
			expect(after.authStatus).toBe("unknown");
			expect(after.authLatencyMs).toBeUndefined();
			expect(after.authCheckedAt).toBeUndefined();
		});

		it("does not overwrite the active profile's cached auth state when called in ad-hoc mode", async () => {
			// Regression test for cross-profile cache clobber: /profile show <other> calls
			// validateToken with explicit apiUrl/apiToken to check a profile that is NOT active.
			// The cached fields (#lastAuthLatencyMs, #lastAuthCheckedAt, #authStatus) are reported
			// by getStatus() as the ACTIVE profile's auth state, so ad-hoc validation must not
			// clobber them.
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			globalThis.fetch = makeMockResponse(200);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await service.validateToken(); // populate cache for active profile
			const before = service.getStatus();
			expect(before.authStatus).toBe("connected");
			expect(typeof before.authLatencyMs).toBe("number");
			const cachedLatency = before.authLatencyMs;
			const cachedCheckedAt = before.authCheckedAt;

			// Ad-hoc validate a DIFFERENT profile by passing explicit apiUrl/apiToken.
			// The result path is 401 — which would set authStatus to "auth_error" if not guarded.
			globalThis.fetch = makeMockResponse(401);
			const adHocResult = await service.validateToken({
				apiUrl: TEST_PROFILE_2.apiUrl,
				apiToken: TEST_PROFILE_2.apiToken,
			});
			expect(adHocResult.status).toBe("auth_error");

			// Active profile's cached state must be unchanged.
			const after = service.getStatus();
			expect(after.authStatus).toBe("connected");
			expect(after.authLatencyMs).toBe(cachedLatency);
			expect(after.authCheckedAt).toBe(cachedCheckedAt);
		});

		it("updates the cache when called with explicit creds that match the active profile", async () => {
			// Regression test: /profile show (with no name, or with the active profile's name)
			// passes explicit apiUrl/apiToken to validateToken via handleShow — but those creds
			// still match the active/effective ones. A naive ad-hoc check that triggers on
			// `options.apiUrl !== undefined` would incorrectly skip the cache refresh, leaving
			// getStatus() consumers stuck on stale auth state after the user explicitly asked
			// for a fresh validation. The refined check compares supplied creds against the
			// active/effective ones and only treats a mismatch as ad-hoc.
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			globalThis.fetch = makeMockResponse(200);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const before = Date.now();
			// Call validateToken with explicit creds that match the active profile — this is
			// exactly what handleShow(ctx, service) does for a `/profile show` on the active profile.
			await service.validateToken({
				apiUrl: TEST_PROFILE.apiUrl,
				apiToken: TEST_PROFILE.apiToken,
			});
			const after = Date.now();

			const status = service.getStatus();
			expect(status.authStatus).toBe("connected");
			expect(typeof status.authLatencyMs).toBe("number");
			expect(typeof status.authCheckedAt).toBe("number");
			expect(status.authCheckedAt).toBeGreaterThanOrEqual(before);
			expect(status.authCheckedAt).toBeLessThanOrEqual(after);
		});
	});

	describe("renameProfile", () => {
		it("renames an inactive profile: file moves, cache updates", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			await service.renameProfile(TEST_PROFILE_2.name, "staging-renamed");

			expect(fs.existsSync(path.join(f5xcProfilesDir, `${TEST_PROFILE_2.name}.json`))).toBe(false);
			expect(fs.existsSync(path.join(f5xcProfilesDir, "staging-renamed.json"))).toBe(true);
			const names = service.listProfileNamesCached();
			expect(names).toContain("staging-renamed");
			expect(names).not.toContain(TEST_PROFILE_2.name);
			expect(service.getStatus().activeProfileName).toBe(TEST_PROFILE.name);
		});

		it("renames the active profile: file moves, pointer updates, onProfileChange fires", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const changes: F5XCProfile[] = [];
			const listener = (p: F5XCProfile) => changes.push(p);
			ProfileService.onProfileChange(listener);
			try {
				await service.renameProfile(TEST_PROFILE.name, "prod-renamed");
			} finally {
				ProfileService.offProfileChange(listener);
			}

			expect(fs.existsSync(path.join(f5xcProfilesDir, `${TEST_PROFILE.name}.json`))).toBe(false);
			expect(fs.existsSync(path.join(f5xcProfilesDir, "prod-renamed.json"))).toBe(true);
			expect(fs.readFileSync(path.join(f5xcConfigDir, "active_profile"), "utf-8").trim()).toBe("prod-renamed");
			expect(service.getStatus().activeProfileName).toBe("prod-renamed");
			expect(changes.length).toBe(1);
			expect(changes[0].name).toBe("prod-renamed");
			// Regression guard: listener payload must carry every field of the
			// renamed profile, not just the new name. A bug where the spread
			// dropped fields would still pass the name check above.
			expect(changes[0].apiUrl).toBe(TEST_PROFILE.apiUrl);
			expect(changes[0].apiToken).toBe(TEST_PROFILE.apiToken);
			expect(changes[0].defaultNamespace).toBe(TEST_PROFILE.defaultNamespace);
		});

		it("throws ProfileError for invalid new name", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await expect(service.renameProfile(TEST_PROFILE.name, "bad name!")).rejects.toThrow(ProfileError);
		});

		it("throws ProfileError when target name already exists", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			await expect(service.renameProfile(TEST_PROFILE.name, TEST_PROFILE_2.name)).rejects.toThrow(/already exists/);
		});

		it("throws ProfileError when source profile does not exist", async () => {
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.renameProfile("nonexistent", "whatever")).rejects.toThrow(/not found/);
		});

		it("throws ProfileError on identity rename of a missing profile", async () => {
			// Regression: renaming a profile to itself must not short-circuit
			// before the existence check, or a typo would silently succeed.
			const service = ProfileService.init(f5xcConfigDir);
			await expect(service.renameProfile("ghost", "ghost")).rejects.toThrow(/not found/);
		});

		it("rolls back when pointer write fails (EISDIR trick)", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			// Pre-create active_profile.tmp as a DIRECTORY — #atomicWrite's
			// writeFileSync(tmpPath, content) will throw EISDIR before the rename
			// step, deterministically triggering the rollback path regardless of
			// the executing UID.
			const tmpPath = path.join(f5xcConfigDir, "active_profile.tmp");
			fs.mkdirSync(tmpPath, { recursive: true });

			try {
				const service = ProfileService.init(f5xcConfigDir);
				await service.loadActive();
				await expect(service.renameProfile(TEST_PROFILE.name, "prod-renamed")).rejects.toThrow(
					/Failed to update active profile pointer/,
				);
				expect(fs.existsSync(path.join(f5xcProfilesDir, `${TEST_PROFILE.name}.json`))).toBe(true);
				expect(fs.existsSync(path.join(f5xcProfilesDir, "prod-renamed.json"))).toBe(false);
				expect(fs.readFileSync(path.join(f5xcConfigDir, "active_profile"), "utf-8").trim()).toBe(TEST_PROFILE.name);
			} finally {
				fs.rmSync(tmpPath, { recursive: true, force: true });
			}
		});
	});
});
