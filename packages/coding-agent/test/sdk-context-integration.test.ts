import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { createAgentSession } from "@f5-sales-demo/xcsh/sdk";
import { ContextService } from "@f5-sales-demo/xcsh/services/xcsh-context";
import { SessionManager } from "@f5-sales-demo/xcsh/session/session-manager";

describe("createAgentSession context tracking", () => {
	const tempDirs: string[] = [];
	let configDir: string;
	let cwd: string;
	let agentDir: string;
	let settings: Settings;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();

		// Save and clear XCSH_* env vars (prevent container env leakage from affecting
		// ContextService.activate or context status derivation).
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) {
				savedEnv[key] = process.env[key];
				delete process.env[key];
			}
		}

		const testDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-context-${Snowflake.next()}-`));
		tempDirs.push(testDir);
		configDir = path.join(testDir, "xcsh-config");
		cwd = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(configDir, { recursive: true });
		fs.mkdirSync(cwd, { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });

		// Settings.init populates the global singleton used by ContextService.activate.
		settings = await Settings.init({ cwd, agentDir, inMemory: true });

		ContextService.init(configDir);
	});

	afterEach(() => {
		ContextService._resetForTest();
		_resetSettingsForTest();
		// Restore XCSH_* env vars
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) process.env[key] = value;
			delete savedEnv[key];
		}
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("scenario 1: emits context_change only at session start when a context is active", async () => {
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.activate("prod");

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
			const contextChanges = entries.filter(e => e.type === "context_change");
			const customMessages = entries.filter(e => e.type === "custom_message");

			expect(contextChanges).toHaveLength(1);
			expect(contextChanges[0]).toMatchObject({
				type: "context_change",
				contextName: "prod",
				tenant: "acme-corp",
				namespace: "production",
			});
			expect(customMessages).toHaveLength(0);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 3: emits no context entries at session start when no context is active", async () => {
		// ContextService initialized in beforeEach but no activate() call.
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
			expect(entries.filter(e => e.type === "context_change")).toHaveLength(0);
			expect(entries.filter(e => e.type === "custom_message")).toHaveLength(0);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 2: session starts with context A; mid-session activate emits both context_change and custom_message", async () => {
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.createContext({
			name: "staging",
			apiUrl: "https://beta-llc.console.ves.volterra.io/api",
			apiToken: "tok2",
			defaultNamespace: "staging",
		});
		await ContextService.instance.activate("prod");

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

			await ContextService.instance.activate("staging");

			const entriesAfter = session.sessionManager.getEntries();
			const added = entriesAfter.slice(entriesBefore);
			const contextChanges = added.filter(e => e.type === "context_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "context_change_notice",
			);

			expect(contextChanges).toHaveLength(1);
			expect(contextChanges[0]).toMatchObject({
				type: "context_change",
				contextName: "staging",
				tenant: "beta-llc",
				namespace: "staging",
			});
			expect(customMessages).toHaveLength(1);
			const content = (customMessages[0] as { content: string }).content;
			expect(content).toContain("[Context switched to staging]");
			expect(content).toContain("Tenant: beta-llc");
			expect(content).toContain("namespace: staging");
			expect((customMessages[0] as { display: boolean }).display).toBe(true);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 4: session starts with NO context; mid-session activate emits both context_change and custom_message", async () => {
		// Two contexts → bootstrap resolveAutoBind returns needsSelection (not bind),
		// so the session genuinely starts with no active context.  This lets us verify
		// that a mid-session activate() correctly emits both context_change (for replay)
		// and custom_message (so the LLM gains context it never had at startup).
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.createContext({
			name: "staging",
			apiUrl: "https://acme-corp-staging.console.ves.volterra.io/api",
			apiToken: "tok-staging",
			defaultNamespace: "staging",
		});
		// No activate() yet — with ≥2 contexts the bootstrap does not auto-bind,
		// so the session genuinely starts with no active context.

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

			await ContextService.instance.activate("prod");

			const entriesAfter = session.sessionManager.getEntries();
			const added = entriesAfter.slice(entriesBefore);
			const contextChanges = added.filter(e => e.type === "context_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "context_change_notice",
			);

			// Regression test for the guard-bug flagged during brainstorming.
			// The session started without a context → the system prompt has no context block.
			// Mid-session activate MUST emit both a context_change (for replay) and a custom_message
			// (so the LLM gains context context it never had at startup).
			expect(contextChanges).toHaveLength(1);
			expect(contextChanges[0]).toMatchObject({
				type: "context_change",
				contextName: "prod",
				tenant: "acme-corp",
				namespace: "production",
			});
			expect(customMessages).toHaveLength(1);
			expect((customMessages[0] as { content: string }).content).toContain("[Context switched to prod]");
		} finally {
			await session.dispose();
		}
	});

	it("scenario 5: re-activating the currently-active context does not emit a spurious custom_message", async () => {
		// Regression test for listener-fires-on-non-switch noise. ContextService fires the
		// onContextChange listener on every #applyToSettings call, including setNamespace,
		// setEnvVars, unsetEnvVars, and re-activation of the same context. Only actual context
		// switches (name changes) should produce an LLM-visible custom_message.
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.activate("prod");

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

			// Re-activate the same context. Listener fires, but name hasn't changed.
			await ContextService.instance.activate("prod");

			const added = session.sessionManager.getEntries().slice(entriesBefore);
			const contextChanges = added.filter(e => e.type === "context_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "context_change_notice",
			);

			expect(contextChanges).toHaveLength(0);
			expect(customMessages).toHaveLength(0);
		} finally {
			await session.dispose();
		}
	});

	it("scenario 6: mid-session activate pushes the notice into agent.state.messages (LLM sees it)", async () => {
		// Regression test: writing only to the session log leaves agent.state.messages stale until
		// compaction or session reload, so the LLM doesn't see the context switch on its next turn.
		// sendCustomMessage must route the notice through agent.appendMessage so it enters the
		// LLM's active context immediately.
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.createContext({
			name: "staging",
			apiUrl: "https://beta-llc.console.ves.volterra.io/api",
			apiToken: "tok2",
			defaultNamespace: "staging",
		});
		await ContextService.instance.activate("prod");

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

			await ContextService.instance.activate("staging");

			// Give the fire-and-forget sendCustomMessage promise a microtask to run.
			await Promise.resolve();

			const messagesAfter = session.state.messages;
			const added = messagesAfter.slice(messagesBefore);
			const customMessages = added.filter(
				m =>
					(m as { role?: string; customType?: string }).role === "custom" &&
					(m as { customType?: string }).customType === "context_change_notice",
			);

			expect(customMessages).toHaveLength(1);
			const customMessageText = (customMessages[0] as { content: string | unknown[] }).content;
			const text = typeof customMessageText === "string" ? customMessageText : JSON.stringify(customMessageText);
			expect(text).toContain("[Context switched to staging]");
		} finally {
			await session.dispose();
		}
	});

	it("scenario 7: disposing a session unregisters its context-change listener", async () => {
		// Regression test for the listener-leak bug. Each createAgentSession registered a listener
		// that closed over that session's sessionManager; disposing the session didn't remove it,
		// so a later /context activate in ANY session would mutate disposed sessions' logs.
		// addDisposeHook + ContextService.offContextChange should prevent this.
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.createContext({
			name: "staging",
			apiUrl: "https://beta-llc.console.ves.volterra.io/api",
			apiToken: "tok2",
			defaultNamespace: "staging",
		});
		await ContextService.instance.activate("prod");

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

		// Activate another context. If the listener still leaked, it would fire and append entries
		// to sessionAManager's in-memory #fileEntries.
		await ContextService.instance.activate("staging");
		await Promise.resolve();

		// sessionAManager should be untouched since its listener was unregistered on dispose.
		expect(sessionAManager.getEntries()).toHaveLength(sessionAEntryCountAtDispose);
	});

	it("bootstrap: fresh session with exactly one context auto-binds it (not pre-activated)", async () => {
		await ContextService.instance.createContext({
			name: "solo",
			apiUrl: "https://solo-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "default",
		});
		// NOTE: do NOT activate — the bootstrap must.
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
			expect(ContextService.instance.getStatus().activeContextName).toBe("solo");
		} finally {
			await session.dispose();
		}
	});

	it("bootstrap: fresh session with multiple contexts and no folder link stays unbound", async () => {
		for (const n of ["alpha", "beta"])
			await ContextService.instance.createContext({
				name: n,
				apiUrl: `https://${n}.console.ves.volterra.io/api`,
				apiToken: "tok",
				defaultNamespace: "default",
			});
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
			expect(ContextService.instance.getStatus().activeContextName ?? null).toBeNull();
		} finally {
			await session.dispose();
		}
	});

	it("bootstrap RESUME: re-activates the session's bound context, winning over ambiguous auto-bind", async () => {
		// Two contexts → a fresh auto-bind would be ambiguous (unbound). But a resumed
		// session whose log bound "beta" must re-activate beta.
		for (const n of ["alpha", "beta"])
			await ContextService.instance.createContext({
				name: n,
				apiUrl: `https://${n}.console.ves.volterra.io/api`,
				apiToken: "tok",
				defaultNamespace: "default",
			});
		const sm = SessionManager.create(cwd, SessionManager.getDefaultSessionDir(cwd, agentDir));
		sm.appendContextChange("beta", "beta", "default"); // simulate a prior activation of beta
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settings,
			sessionManager: sm,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});
		try {
			expect(ContextService.instance.getStatus().activeContextName).toBe("beta");
		} finally {
			await session.dispose();
		}
	});

	it("scenario 8: mid-session /context namespace emits context_change + custom_message", async () => {
		// Regression test for the name-only guard bug. /context namespace staging fires the
		// listener but keeps the same context name; previous guard (name-only) skipped emission,
		// leaving the LLM anchored on the old namespace. New guard (name-or-namespace) emits.
		await ContextService.instance.createContext({
			name: "prod",
			apiUrl: "https://acme-corp.console.ves.volterra.io/api",
			apiToken: "tok",
			defaultNamespace: "production",
		});
		await ContextService.instance.activate("prod");

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

			ContextService.instance.setNamespace("staging");
			await Promise.resolve();

			const added = session.sessionManager.getEntries().slice(entriesBefore);
			const contextChanges = added.filter(e => e.type === "context_change");
			const customMessages = added.filter(
				e => e.type === "custom_message" && (e as { customType?: string }).customType === "context_change_notice",
			);

			expect(contextChanges).toHaveLength(1);
			expect(contextChanges[0]).toMatchObject({
				type: "context_change",
				contextName: "prod",
				tenant: "acme-corp",
				namespace: "staging",
			});
			expect(customMessages).toHaveLength(1);
			const content = (customMessages[0] as { content: string }).content;
			// Content should mention the namespace change. Exact wording is "[F5 XC namespace
			// changed to staging]" (not "[Context switched to prod]" — the name didn't change).
			expect(content).toContain("namespace changed to staging");
			expect(content).toContain("Tenant: acme-corp");
			expect(content).toContain("namespace: staging");
		} finally {
			await session.dispose();
		}
	});
});
