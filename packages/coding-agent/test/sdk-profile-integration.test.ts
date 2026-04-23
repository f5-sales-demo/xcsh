import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { createAgentSession } from "@f5xc-salesdemos/xcsh/sdk";
import { ProfileService } from "@f5xc-salesdemos/xcsh/services/f5xc-profile";

describe("createAgentSession profile tracking", () => {
	const tempDirs: string[] = [];
	let configDir: string;
	let cwd: string;
	let agentDir: string;
	let settings: Settings;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ProfileService._resetForTest();

		// Save and clear F5XC_* env vars (prevent container env leakage from affecting
		// ProfileService.activate or profile status derivation).
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) {
				savedEnv[key] = process.env[key];
				delete process.env[key];
			}
		}

		const testDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-profile-${Snowflake.next()}-`));
		tempDirs.push(testDir);
		configDir = path.join(testDir, "f5xc-config");
		cwd = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(configDir, { recursive: true });
		fs.mkdirSync(cwd, { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });

		// Settings.init populates the global singleton used by ProfileService.activate.
		settings = await Settings.init({ cwd, agentDir, inMemory: true });

		ProfileService.init(configDir);
	});

	afterEach(() => {
		ProfileService._resetForTest();
		_resetSettingsForTest();
		// Restore F5XC_* env vars
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) process.env[key] = value;
			delete savedEnv[key];
		}
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("scenario 1: emits profile_change only at session start when a profile is active", async () => {
		await ProfileService.instance.createProfile({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ProfileService.instance.activate("prod");

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settings,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			const entries = session.sessionManager.getEntries();
			const profileChanges = entries.filter(e => e.type === "profile_change");
			const customMessages = entries.filter(e => e.type === "custom_message");

			expect(profileChanges).toHaveLength(1);
			expect(profileChanges[0]).toMatchObject({
				type: "profile_change",
				profileName: "prod",
				tenant: "acme-corp",
				namespace: "production",
			});
			expect(customMessages).toHaveLength(0);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 3: emits no profile entries at session start when no profile is active", async () => {
		// ProfileService initialized in beforeEach but no activate() call.
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settings,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			const entries = session.sessionManager.getEntries();
			expect(entries.filter(e => e.type === "profile_change")).toHaveLength(0);
			expect(entries.filter(e => e.type === "custom_message")).toHaveLength(0);
		} finally {
			await session.dispose();
		}
	});
});
