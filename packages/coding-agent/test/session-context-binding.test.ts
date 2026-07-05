import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import {
	type AutoBindResult,
	activateTenantContext,
	chooseSessionContext,
	resolveAutoBind,
	shouldRunSessionContextBootstrap,
} from "../src/services/session-context-binding";
import { ContextService } from "../src/services/xcsh-context";

describe("resolveAutoBind — cli", () => {
	test("folder-linked context wins", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: ["a", "b"], folderContext: "b" })).toEqual({
			kind: "bind",
			contextName: "b",
		});
	});
	test("exactly one context auto-binds", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: ["only"], folderContext: null })).toEqual({
			kind: "bind",
			contextName: "only",
		});
	});
	test("multiple contexts, no link → needsSelection", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: ["a", "b"], folderContext: null })).toEqual({
			kind: "needsSelection",
		});
	});
	test("no contexts → none", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: [], folderContext: null })).toEqual({ kind: "none" });
	});
});

describe("resolveAutoBind — extension", () => {
	test("matches a context by tenant key", () => {
		expect(
			resolveAutoBind({
				kind: "extension",
				availableContexts: ["acme", "globex"],
				tenantKey: "globex|production",
				contextTenantKeys: { acme: "acme|staging", globex: "globex|production" },
			}),
		).toEqual({ kind: "bind", contextName: "globex" });
	});
	test("no tenant match → needsSelection", () => {
		expect(
			resolveAutoBind({
				kind: "extension",
				availableContexts: ["acme"],
				tenantKey: "globex|production",
				contextTenantKeys: { acme: "acme|staging" },
			}),
		).toEqual({ kind: "needsSelection" });
	});
	test("no tenant key → none", () => {
		expect(resolveAutoBind({ kind: "extension", availableContexts: ["acme"], tenantKey: null })).toEqual({
			kind: "none",
		});
	});
});

describe("chooseSessionContext", () => {
	const bindA: AutoBindResult = { kind: "bind", contextName: "a" };
	test("resume: bound name wins over auto-bind", () => {
		expect(chooseSessionContext("resumed", bindA)).toEqual({ activate: "resumed" });
	});
	test("new: falls back to auto-bind result", () => {
		expect(chooseSessionContext(undefined, bindA)).toEqual({ activate: "a" });
	});
	test("new + needsSelection", () => {
		expect(chooseSessionContext(undefined, { kind: "needsSelection" })).toEqual({ needsSelection: true });
	});
	test("new + none", () => {
		expect(chooseSessionContext(undefined, { kind: "none" })).toEqual({ none: true });
	});
});

describe("shouldRunSessionContextBootstrap", () => {
	// Repro (isolation bug): a pre-warmed spare is spawned with no XCSH_API_URL
	// and no XCSH_SESSION_TENANT. Without the spare marker it would fall into the
	// create-time CLI auto-bind branch and, with exactly one stored context,
	// boot-activate that tenant's credentials BEFORE any IPC bind — breaking the
	// "identity-less spare holds no tenant credentials until bind" guarantee.
	// The XCSH_WORKER_SPARE marker must suppress the boot-time bootstrap so the
	// spare stays contextless until its IPC bind calls activateTenantContext().
	test("spare (XCSH_WORKER_SPARE set, no api url) → false", () => {
		expect(shouldRunSessionContextBootstrap({ XCSH_WORKER_SPARE: "1" })).toBe(false);
	});
	test("interactive CLI / cold worker (no api url, no spare marker) → true", () => {
		expect(shouldRunSessionContextBootstrap({})).toBe(true);
	});
	test("api url set → false (env-credentialed, never bootstraps)", () => {
		expect(shouldRunSessionContextBootstrap({ XCSH_API_URL: "https://x.console.ves.volterra.io/api" })).toBe(false);
	});
	test("api url set AND spare marker → false", () => {
		expect(shouldRunSessionContextBootstrap({ XCSH_API_URL: "https://x/api", XCSH_WORKER_SPARE: "1" })).toBe(false);
	});
});

describe("activateTenantContext", () => {
	let dir: TempDir;
	const savedApiUrl = process.env.XCSH_API_URL;
	beforeEach(async () => {
		// activate() throws when XCSH_API_URL overrides the context — scrub it for isolation.
		delete process.env.XCSH_API_URL;
		_resetSettingsForTest();
		ContextService._resetForTest();
		dir = TempDir.createSync("@pi-actx-");
		await Settings.init({ cwd: dir.path(), agentDir: dir.path(), inMemory: true });
		ContextService.init(dir.path());
	});
	afterEach(() => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		dir.removeSync();
		if (savedApiUrl !== undefined) process.env.XCSH_API_URL = savedApiUrl;
	});

	test("activates the context whose apiUrl matches the tenant key", async () => {
		// Create a stored context for tenant "acme" on production.
		await ContextService.instance.createContext({
			name: "acme-prod",
			apiUrl: "https://acme.console.ves.volterra.io/api",
			apiToken: "t",
			defaultNamespace: "system",
		});
		const activated = await activateTenantContext("acme|production");
		expect(activated).toBe(true);
		expect(ContextService.instance.getStatus().activeContextName).toBe("acme-prod");
	});

	test("returns false and leaves unbound when no context matches", async () => {
		const activated = await activateTenantContext("nomatch|production");
		expect(activated).toBe(false);
		expect(ContextService.instance.getStatus().activeContextName).toBeNull();
	});
});
