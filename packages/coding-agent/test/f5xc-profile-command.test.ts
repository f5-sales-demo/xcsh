import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { CURRENT_SCHEMA_VERSION, ProfileService } from "@f5xc-salesdemos/xcsh/services/f5xc-profile";
import { handleProfileCommand } from "@f5xc-salesdemos/xcsh/services/f5xc-profile-command";
import {
	formatAuthIndicator,
	formatExpiration,
	formatRelativeTime,
	renderF5XCTable,
} from "@f5xc-salesdemos/xcsh/services/f5xc-table";
import { TEST_PROFILE, TEST_PROFILE_STAGING as TEST_PROFILE_2 } from "./f5xc-test-fixtures";

describe("formatAuthIndicator", () => {
	it("includes latencyMs for offline results", () => {
		const result = formatAuthIndicator("offline", 342, "network");
		expect(result).toContain("342ms");
	});

	it("shows credential-specific text for auth_error", () => {
		const result = formatAuthIndicator("auth_error", 100, "credential");
		expect(result).toContain("check token");
	});

	it("shows network-specific text for offline", () => {
		const result = formatAuthIndicator("offline", undefined, "network");
		expect(result).toContain("network");
	});

	it("shows connected without errorClass", () => {
		const result = formatAuthIndicator("connected", 50);
		expect(result).toContain("Connected");
		expect(result).toContain("50ms");
	});
});

describe("formatRelativeTime", () => {
	const now = new Date("2026-04-23T12:00:00Z");

	it("returns 'just now' for less than 1 minute ago", () => {
		const recent = new Date(now.getTime() - 30_000).toISOString();
		expect(formatRelativeTime(recent, now)).toBe("just now");
	});

	it("returns '15 minutes ago'", () => {
		const t = new Date(now.getTime() - 15 * 60_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("15 minutes ago");
	});

	it("returns '3 hours ago'", () => {
		const t = new Date(now.getTime() - 3 * 3_600_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("3 hours ago");
	});

	it("returns '3 days ago'", () => {
		const t = new Date(now.getTime() - 3 * 86_400_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("3 days ago");
	});

	it("returns '3 months ago'", () => {
		const t = new Date(now.getTime() - 90 * 86_400_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("3 months ago");
	});

	it("uses singular '1 day ago'", () => {
		const t = new Date(now.getTime() - 1 * 86_400_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("1 day ago");
	});
});

describe("formatExpiration", () => {
	const now = new Date("2026-04-23T12:00:00Z");

	it("returns bare date string when more than 7 days away", () => {
		const future = "2026-05-10T00:00:00.000Z";
		const result = formatExpiration(future, now);
		expect(result).toBe("2026-05-10");
		expect(result).not.toContain("⚠");
		expect(result).not.toContain("expires");
	});

	it("shows warning when within 7 days", () => {
		const soon = "2026-04-28T00:00:00.000Z";
		const result = formatExpiration(soon, now);
		expect(result).toContain("expires in");
	});

	it("shows warning for today (0 days)", () => {
		const today = "2026-04-23T23:59:00.000Z";
		const result = formatExpiration(today, now);
		expect(result).toContain("expires in");
	});

	it("shows 'expired' warning for past dates", () => {
		const past = "2026-04-01T00:00:00.000Z";
		const result = formatExpiration(past, now);
		expect(result).toContain("expired");
	});

	it("uses singular '1 day' in warning", () => {
		// 20 hours after now — ceil((20h) / 24h) = 1 day
		const tomorrow = "2026-04-24T08:00:00.000Z";
		const result = formatExpiration(tomorrow, now);
		expect(result).toContain("1 day");
		expect(result).not.toMatch(/1 days/);
	});
});

describe("renderF5XCTable", () => {
	it("renders multiple labeled dividers", () => {
		const rows = [
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
			{ key: "C", value: "3" },
			{ key: "D", value: "4" },
		];
		const result = renderF5XCTable("test", rows, {
			dividers: [
				{ before: 2, label: "Section Two" },
				{ before: 3, label: "Section Three" },
			],
		});
		const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("Section Two");
		expect(plain).toContain("Section Three");
	});

	it("renders with no dividers (backwards compatible)", () => {
		const rows = [{ key: "A", value: "1" }];
		const result = renderF5XCTable("test", rows);
		expect(result).toContain("A");
		expect(result).not.toContain("Environment");
	});
});

function writeProfile(
	profilesDir: string,
	profile: { name: string; apiUrl: string; apiToken: string; defaultNamespace: string },
): void {
	fs.mkdirSync(profilesDir, { recursive: true });
	fs.writeFileSync(path.join(profilesDir, `${profile.name}.json`), JSON.stringify(profile, null, 2), { mode: 0o600 });
}

function writeActiveProfile(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_profile"), name);
}

/** Minimal mock of InteractiveModeContext for slash command testing */
function createMockCtx() {
	const messages: { type: string; text: string }[] = [];
	return {
		messages,
		showStatus(msg: string) {
			messages.push({ type: "status", text: msg });
		},
		showError(msg: string) {
			messages.push({ type: "error", text: msg });
		},
		showWarning(msg: string) {
			messages.push({ type: "warning", text: msg });
		},
		editor: { setText(_text: string) {} },
		statusLine: { invalidate() {} },
		updateEditorTopBorder() {},
		ui: { requestRender() {} },
	};
}

describe("/profile slash command handler", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcProfilesDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ProfileService._resetForTest();
		// Ensure F5XC env vars don't leak from system environment
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}

		testDir = path.join(os.tmpdir(), "test-f5xc-cmd", Snowflake.next());
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
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("/profile list shows profiles with active marker", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "list", text: "/profile list" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("* production");
		expect(ctx.messages[0].text).toContain("  staging");
	});

	it("/profile list shows helpful message when no profiles", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "list", text: "/profile list" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("No F5 XC profiles found");
	});

	it("/profile activate switches profile", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "activate staging", text: "/profile activate staging" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		// Activate now shows the same red table as /profile show
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("staging");
		expect(plain).toContain("F5XC_TENANT");

		const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
		expect(bashEnv.F5XC_API_URL).toBe(TEST_PROFILE_2.apiUrl);
	});

	it("/profile activate with no arg shows error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "activate", text: "/profile activate" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/profile show displays masked token", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		const loaded = await service.loadActive();
		expect(loaded).not.toBeNull(); // Ensure profile actually loaded

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "show", text: "/profile show" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain(`...${TEST_PROFILE.apiToken.slice(-4)}`);
		// Full token must NEVER appear in output
		expect(ctx.messages[0].text).not.toContain(TEST_PROFILE.apiToken);
	});

	it("/profile status shows auth status", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "status", text: "/profile status" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("production");
		expect(ctx.messages[0].text).toContain("profile");
	});

	// --- /profile create ---

	it("/profile create with valid args creates profile and shows success", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{
				name: "profile",
				args: "create myprof https://t.console.ves.volterra.io tok-secret staging-ns",
				text: "/profile create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("Profile 'myprof' created");
		// Profile file should exist on disk
		expect(fs.existsSync(path.join(f5xcProfilesDir, "myprof.json"))).toBe(true);
	});

	it("/profile create defaults namespace to 'default' when omitted", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{
				name: "profile",
				args: "create myprof https://t.console.ves.volterra.io tok-secret",
				text: "/profile create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		const data = JSON.parse(fs.readFileSync(path.join(f5xcProfilesDir, "myprof.json"), "utf-8"));
		expect(data.defaultNamespace).toBe("default");
	});

	it("/profile create with missing args shows usage error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "create myprof", text: "/profile create myprof" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/profile create with invalid profile name shows error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{
				name: "profile",
				args: "create ../../bad https://t.console.ves.volterra.io tok",
				text: "/profile create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("alphanumeric");
	});

	it("/profile create with HTTP URL (not HTTPS) shows error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: "create valid http://insecure.example.com tok", text: "/profile create ..." },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("HTTPS");
	});

	it("/profile create with invalid URL shows error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: "create valid not-a-url tok", text: "/profile create ..." },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("HTTPS");
	});

	it("/profile create with duplicate name shows error", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{
				name: "profile",
				args: `create ${TEST_PROFILE.name} https://t.console.ves.volterra.io tok`,
				text: "/profile create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("already exists");
	});

	it("/profile create success output never contains raw token", async () => {
		const secretToken = "super-secret-token-value-12345";
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{
				name: "profile",
				args: `create myprof https://t.console.ves.volterra.io ${secretToken}`,
				text: "/profile create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).not.toContain(secretToken);
	});

	// --- /profile delete ---

	it("/profile delete with --confirm deletes profile and shows success", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: "delete staging --confirm", text: "/profile delete staging --confirm" },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("deleted");
		expect(fs.existsSync(path.join(f5xcProfilesDir, "staging.json"))).toBe(false);
	});

	it("/profile delete without --confirm shows confirmation prompt", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "delete staging", text: "/profile delete staging" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("--confirm");
		// File should still exist
		expect(fs.existsSync(path.join(f5xcProfilesDir, "staging.json"))).toBe(true);
	});

	it("/profile delete with no name shows usage error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "delete", text: "/profile delete" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/profile delete prevents deleting the active profile", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand(
			{
				name: "profile",
				args: `delete ${TEST_PROFILE.name} --confirm`,
				text: "/profile delete production --confirm",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Cannot delete the active profile");
	});

	it("/profile delete non-existent profile with --confirm shows error", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: "delete ghost --confirm", text: "/profile delete ghost --confirm" },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("not found");
	});

	it("/profile (no subcommand) defaults to list", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "", text: "/profile" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("* production");
	});

	// --- /profile namespace ---

	it("/profile namespace switches namespace and shows confirmation", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: "namespace other-ns", text: "/profile namespace other-ns" },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("Namespace switched to: other-ns");

		// Verify it actually changed
		expect(service.getStatus().activeProfileNamespace).toBe("other-ns");
	});

	it("/profile namespace with no arg shows usage", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "namespace", text: "/profile namespace" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/profile unknown shows error with valid subcommands", async () => {
		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "banana", text: "/profile banana" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Unknown subcommand");
	});

	it("/profile list shows version warning suffix for incompatible profiles", async () => {
		fs.mkdirSync(f5xcProfilesDir, { recursive: true });
		fs.writeFileSync(
			path.join(f5xcProfilesDir, "future.json"),
			JSON.stringify(
				{
					name: "future",
					apiUrl: "https://example.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
					version: CURRENT_SCHEMA_VERSION + 1,
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);

		ProfileService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "list", text: "/profile list" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("future");
		expect(ctx.messages[0].text).toContain("upgrade required");
	});

	describe("error message actionability", () => {
		it("/profile activate with no name shows usage with /profile list hint", async () => {
			ProfileService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "activate", text: "/profile activate" }, ctx);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("/profile list");
		});

		it("/profile show with no active profile shows create/activate hint", async () => {
			ProfileService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "show", text: "/profile show" }, ctx);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("/profile create");
			expect(ctx.messages[0].text).toContain("/profile activate");
		});

		it("/profile show with unknown profile name shows /profile list hint", async () => {
			ProfileService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "show ghost", text: "/profile show ghost" }, ctx);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("ghost");
			expect(ctx.messages[0].text).toContain("/profile list");
		});

		it("/profile delete active profile shows activate-other hint", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);
			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();
			const ctx = createMockCtx();
			await handleProfileCommand(
				{
					name: "profile",
					args: `delete ${TEST_PROFILE.name} --confirm`,
					text: "/profile delete production --confirm",
				},
				ctx,
			);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("/profile activate");
		});
	});

	// --- /profile show metadata display ---

	describe("/profile show metadata display", () => {
		it("shows metadata section when profile has metadata", async () => {
			const metaProfile = {
				name: "meta-test",
				apiUrl: TEST_PROFILE.apiUrl,
				apiToken: TEST_PROFILE.apiToken,
				defaultNamespace: TEST_PROFILE.defaultNamespace,
				metadata: {
					createdAt: "2026-01-01T00:00:00.000Z",
					expiresAt: "2027-06-01T00:00:00.000Z",
					lastRotatedAt: "2026-03-01T00:00:00.000Z",
					rotateAfterDays: 90,
				},
			};
			writeProfile(f5xcProfilesDir, metaProfile);
			writeActiveProfile(f5xcConfigDir, "meta-test");

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "show", text: "/profile show" }, ctx);

			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).toContain("Metadata");
			expect(plain).toContain("Created");
			expect(plain).toContain("Expires");
			expect(plain).toContain("Last Rotated");
			expect(plain).toContain("every 90 days");
		});

		it("does not show metadata section when profile has no metadata", async () => {
			writeProfile(f5xcProfilesDir, TEST_PROFILE);
			writeActiveProfile(f5xcConfigDir, TEST_PROFILE.name);

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "show", text: "/profile show" }, ctx);

			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).not.toContain("Metadata");
			expect(plain).not.toContain("Created");
		});

		it("shows only createdAt when that is the only metadata field", async () => {
			const minMetaProfile = {
				name: "min-meta",
				apiUrl: TEST_PROFILE.apiUrl,
				apiToken: TEST_PROFILE.apiToken,
				defaultNamespace: TEST_PROFILE.defaultNamespace,
				metadata: { createdAt: "2026-01-01T00:00:00.000Z" },
			};
			writeProfile(f5xcProfilesDir, minMetaProfile);
			writeActiveProfile(f5xcConfigDir, "min-meta");

			const service = ProfileService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "show", text: "/profile show" }, ctx);

			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).toContain("Metadata");
			expect(plain).toContain("Created");
			expect(plain).not.toContain("Expires");
			expect(plain).not.toContain("Last Rotated");
		});
	});

	// --- /profile validate ---

	it("/profile validate with no arg shows error pointing at /profile status", async () => {
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "validate", text: "/profile validate" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage: /profile validate <name>");
		expect(ctx.messages[0].text).toContain("/profile status");
	});

	it("/profile validate <name> renders a validation-only table for an existing profile", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const savedFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(new Response("ok", { status: 200 }))) as unknown as typeof globalThis.fetch;
		try {
			ProfileService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleProfileCommand(
				{ name: "profile", args: `validate ${TEST_PROFILE.name}`, text: `/profile validate ${TEST_PROFILE.name}` },
				ctx,
			);
			expect(ctx.messages[0].type).toBe("status");
			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).toContain(TEST_PROFILE.name);
			expect(plain).toContain("validation only");
			expect(plain).toContain("F5XC_API_URL");
			expect(plain).toContain("F5XC_API_TOKEN");
			expect(plain).toContain(`...${TEST_PROFILE.apiToken.slice(-4)}`);
		} finally {
			globalThis.fetch = savedFetch;
		}
	});

	it("/profile validate <missing> surfaces ProfileError via showError", async () => {
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: "validate nonexistent", text: "/profile validate nonexistent" },
			ctx,
		);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not found/i);
	});

	it("/profile rename with no args shows error", async () => {
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "rename", text: "/profile rename" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/profile rename <old> with only one arg shows error", async () => {
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "rename onlyone", text: "/profile rename onlyone" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/profile rename <old> <new> renames and reports success", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `rename ${TEST_PROFILE.name} prod-new`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain(`'${TEST_PROFILE.name}'`);
		expect(ctx.messages[0].text).toContain("'prod-new'");
	});

	it("/profile rename surfaces ProfileError when target exists", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleProfileCommand(
			{ name: "profile", args: `rename ${TEST_PROFILE.name} ${TEST_PROFILE_2.name}`, text: "" },
			ctx,
		);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/already exists/);
	});

	it("/profile export emits a masked bundle by default", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "export", text: "/profile export" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.version).toBe(1);
		expect(parsed.tokensMasked).toBe(true);
		expect(parsed.profiles[0].apiToken.startsWith("...")).toBe(true);
	});

	it("/profile export <name> filters to one profile", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		writeProfile(f5xcProfilesDir, TEST_PROFILE_2);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `export ${TEST_PROFILE.name}`, text: "" }, ctx);
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.profiles.length).toBe(1);
		expect(parsed.profiles[0].name).toBe(TEST_PROFILE.name);
	});

	it("/profile export --include-token emits unmasked tokens", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "export --include-token", text: "" }, ctx);
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.tokensMasked).toBe(false);
		expect(parsed.profiles[0].apiToken).toBe(TEST_PROFILE.apiToken);
	});

	it("/profile export surfaces not-found errors", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "export nonexistent", text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not found/);
	});

	it("/profile import with no arg shows usage error", async () => {
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "import", text: "/profile import" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage: /profile import");
	});

	it("/profile import <path> imports from a file", async () => {
		const bundlePath = path.join(testDir, "bundle.json");
		fs.writeFileSync(
			bundlePath,
			JSON.stringify({
				version: 1,
				exportedAt: new Date().toISOString(),
				tokensMasked: false,
				profiles: [TEST_PROFILE],
			}),
		);
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${bundlePath}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toMatch(/imported/i);
		expect(fs.existsSync(path.join(f5xcProfilesDir, `${TEST_PROFILE.name}.json`))).toBe(true);
	});

	it("/profile import {inline JSON} parses inline", async () => {
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			profiles: [TEST_PROFILE],
		});
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(fs.existsSync(path.join(f5xcProfilesDir, `${TEST_PROFILE.name}.json`))).toBe(true);
	});

	it("/profile import ~/file expands tilde", async () => {
		const savedHome = process.env.HOME;
		process.env.HOME = testDir;
		try {
			const bundlePath = path.join(testDir, "bundle.json");
			fs.writeFileSync(
				bundlePath,
				JSON.stringify({
					version: 1,
					exportedAt: "",
					tokensMasked: false,
					profiles: [TEST_PROFILE],
				}),
			);
			ProfileService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleProfileCommand({ name: "profile", args: "import ~/bundle.json", text: "" }, ctx);
			expect(ctx.messages[0].type).toBe("status");
		} finally {
			if (savedHome === undefined) delete process.env.HOME;
			else process.env.HOME = savedHome;
		}
	});

	it("/profile import surfaces conflict error without --overwrite", async () => {
		writeProfile(f5xcProfilesDir, TEST_PROFILE);
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			profiles: [TEST_PROFILE],
		});
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/conflict/i);
	});

	it("/profile import --overwrite replaces conflicting profiles", async () => {
		writeProfile(f5xcProfilesDir, { ...TEST_PROFILE, defaultNamespace: "old" });
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			profiles: [{ ...TEST_PROFILE, defaultNamespace: "new" }],
		});
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${inline} --overwrite`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toMatch(/overwrote/i);
	});

	it("/profile import rejects masked bundle", async () => {
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: true,
			profiles: [{ ...TEST_PROFILE, apiToken: "...g7h8" }],
		});
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/masked tokens/i);
	});

	it("/profile import reports unreadable path cleanly", async () => {
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: "import /nonexistent/nope.json", text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not found|no such/i);
	});

	it("/profile import reports non-JSON file cleanly", async () => {
		const bundlePath = path.join(testDir, "garbage.json");
		fs.writeFileSync(bundlePath, "not actually json");
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${bundlePath}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not valid JSON|missing required fields/i);
	});

	it("/profile import preserves whitespace runs inside inline JSON string values", async () => {
		// Regression: prior implementation tokenized args on /\s+/ and rejoined
		// with single spaces, collapsing multi-space runs inside string values.
		// A token/password like "foo   bar" would become "foo bar" before JSON.parse,
		// importing a corrupted credential.
		const weirdToken = "token\twith   embedded\t\twhitespace";
		const profileWithWhitespace = {
			...TEST_PROFILE,
			apiToken: weirdToken,
		};
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			profiles: [profileWithWhitespace],
		});
		ProfileService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		// The imported profile on disk must have the original token bytes intact.
		const onDiskPath = path.join(f5xcProfilesDir, `${TEST_PROFILE.name}.json`);
		const onDisk = JSON.parse(fs.readFileSync(onDiskPath, "utf-8"));
		expect(onDisk.apiToken).toBe(weirdToken);
	});

	it("/profile import accepts --overwrite as a leading flag", async () => {
		writeProfile(f5xcProfilesDir, { ...TEST_PROFILE, defaultNamespace: "original" });
		const service = ProfileService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			profiles: [{ ...TEST_PROFILE, defaultNamespace: "new" }],
		});
		const ctx = createMockCtx();
		await handleProfileCommand({ name: "profile", args: `import --overwrite ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toMatch(/overwrote/i);
	});
});
