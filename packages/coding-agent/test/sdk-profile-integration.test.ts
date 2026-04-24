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

	it("scenario 2: session starts with profile A; mid-session activate emits both profile_change and custom_message", async () => {
		await ProfileService.instance.createProfile({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ProfileService.instance.createProfile({
			name: "staging",
			apiUrl: "https://beta-llc.console.ves.volterra.io/api",
			apiToken: "tok2",
			defaultNamespace: "staging",
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
			const entriesBefore = session.sessionManager.getEntries().length;

			await ProfileService.instance.activate("staging");

			const entriesAfter = session.sessionManager.getEntries();
			const added = entriesAfter.slice(entriesBefore);
			const profileChanges = added.filter(e => e.type === "profile_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "profile_change_notice",
			);

			expect(profileChanges).toHaveLength(1);
			expect(profileChanges[0]).toMatchObject({
				type: "profile_change",
				profileName: "staging",
				tenant: "beta-llc",
				namespace: "staging",
			});
			expect(customMessages).toHaveLength(1);
			const content = (customMessages[0] as { content: string }).content;
			expect(content).toContain("[Profile switched to staging]");
			expect(content).toContain("Tenant: beta-llc");
			expect(content).toContain("namespace: staging");
			expect((customMessages[0] as { display: boolean }).display).toBe(true);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 4: session starts with NO profile; mid-session activate emits both profile_change and custom_message", async () => {
		await ProfileService.instance.createProfile({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		// No activate() yet — session launches with no active profile.

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
			const entriesBefore = session.sessionManager.getEntries().length;

			await ProfileService.instance.activate("prod");

			const entriesAfter = session.sessionManager.getEntries();
			const added = entriesAfter.slice(entriesBefore);
			const profileChanges = added.filter(e => e.type === "profile_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "profile_change_notice",
			);

			// Regression test for the guard-bug flagged during brainstorming.
			// The session started without a profile → the system prompt has no profile block.
			// Mid-session activate MUST emit both a profile_change (for replay) and a custom_message
			// (so the LLM gains profile context it never had at startup).
			expect(profileChanges).toHaveLength(1);
			expect(profileChanges[0]).toMatchObject({
				type: "profile_change",
				profileName: "prod",
				tenant: "acme-corp",
				namespace: "production",
			});
			expect(customMessages).toHaveLength(1);
			expect((customMessages[0] as { content: string }).content).toContain("[Profile switched to prod]");
		} finally {
			await session.dispose();
		}
	});

	it("scenario 5: re-activating the currently-active profile does not emit a spurious custom_message", async () => {
		// Regression test for listener-fires-on-non-switch noise. ProfileService fires the
		// onProfileChange listener on every #applyToSettings call, including setNamespace,
		// setEnvVars, unsetEnvVars, and re-activation of the same profile. Only actual profile
		// switches (name changes) should produce an LLM-visible custom_message.
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
			const entriesBefore = session.sessionManager.getEntries().length;

			// Re-activate the same profile. Listener fires, but name hasn't changed.
			await ProfileService.instance.activate("prod");

			const added = session.sessionManager.getEntries().slice(entriesBefore);
			const profileChanges = added.filter(e => e.type === "profile_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "profile_change_notice",
			);

			expect(profileChanges).toHaveLength(0);
			expect(customMessages).toHaveLength(0);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 6: mid-session activate pushes the notice into agent.state.messages (LLM sees it)", async () => {
		// Regression test: writing only to the session log leaves agent.state.messages stale until
		// compaction or session reload, so the LLM doesn't see the profile switch on its next turn.
		// sendCustomMessage must route the notice through agent.appendMessage so it enters the
		// LLM's active context immediately.
		await ProfileService.instance.createProfile({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ProfileService.instance.createProfile({
			name: "staging",
			apiUrl: "https://beta-llc.console.ves.volterra.io/api",
			apiToken: "tok2",
			defaultNamespace: "staging",
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
			const messagesBefore = session.state.messages.length;

			await ProfileService.instance.activate("staging");

			// Give the fire-and-forget sendCustomMessage promise a microtask to run.
			await Promise.resolve();

			const messagesAfter = session.state.messages;
			const added = messagesAfter.slice(messagesBefore);
			const customMessages = added.filter(
				m =>
					(m as { role?: string; customType?: string }).role === "custom" &&
					(m as { customType?: string }).customType === "profile_change_notice",
			);

			expect(customMessages).toHaveLength(1);
			const customMessageText = (customMessages[0] as { content: string | unknown[] }).content;
			const text = typeof customMessageText === "string" ? customMessageText : JSON.stringify(customMessageText);
			expect(text).toContain("[Profile switched to staging]");
		} finally {
			await session.dispose();
		}
	});

	it("scenario 7: disposing a session unregisters its profile-change listener", async () => {
		// Regression test for the listener-leak bug. Each createAgentSession registered a listener
		// that closed over that session's sessionManager; disposing the session didn't remove it,
		// so a later /profile activate in ANY session would mutate disposed sessions' logs.
		// addDisposeHook + ProfileService.offProfileChange should prevent this.
		await ProfileService.instance.createProfile({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ProfileService.instance.createProfile({
			name: "staging",
			apiUrl: "https://beta-llc.console.ves.volterra.io/api",
			apiToken: "tok2",
			defaultNamespace: "staging",
		});
		await ProfileService.instance.activate("prod");

		// Create and immediately dispose session A — capture sessionManager ref for later inspection.
		const { session: sessionA } = await createAgentSession({
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
		const sessionAManager = sessionA.sessionManager;
		const sessionAEntryCountAtDispose = sessionAManager.getEntries().length;
		await sessionA.dispose();

		// Activate another profile. If the listener still leaked, it would fire and append entries
		// to sessionAManager's in-memory #fileEntries.
		await ProfileService.instance.activate("staging");
		await Promise.resolve();

		// sessionAManager should be untouched since its listener was unregistered on dispose.
		expect(sessionAManager.getEntries()).toHaveLength(sessionAEntryCountAtDispose);
	});

	it("scenario 8: mid-session /profile namespace emits profile_change + custom_message", async () => {
		// Regression test for the name-only guard bug. /profile namespace staging fires the
		// listener but keeps the same profile name; previous guard (name-only) skipped emission,
		// leaving the LLM anchored on the old namespace. New guard (name-or-namespace) emits.
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
			const entriesBefore = session.sessionManager.getEntries().length;

			ProfileService.instance.setNamespace("staging");
			await Promise.resolve();

			const added = session.sessionManager.getEntries().slice(entriesBefore);
			const profileChanges = added.filter(e => e.type === "profile_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "profile_change_notice",
			);

			expect(profileChanges).toHaveLength(1);
			expect(profileChanges[0]).toMatchObject({
				type: "profile_change",
				profileName: "prod",
				tenant: "acme-corp",
				namespace: "staging",
			});
			expect(customMessages).toHaveLength(1);
			const content = (customMessages[0] as { content: string }).content;
			// Content should mention the namespace change. Exact wording is "[F5 XC namespace
			// changed to staging]" (not "[Profile switched to prod]" — the name didn't change).
			expect(content).toContain("namespace changed to staging");
			expect(content).toContain("Tenant: acme-corp");
			expect(content).toContain("namespace: staging");
		} finally {
			await session.dispose();
		}
	});
});
