import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { BUILTIN_SLASH_COMMANDS } from "@f5-sales-demo/xcsh/extensibility/slash-commands";
import { ContextService, type XCSHContext } from "@f5-sales-demo/xcsh/services/xcsh-context";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@f5-sales-demo/xcsh/slash-commands/builtin-registry";
import {
	TEST_CONTEXT,
	TEST_CONTEXT_INCOMPATIBLE,
	TEST_CONTEXT_STAGING,
	TEST_CONTEXT_WITH_ENV,
} from "./xcsh-test-fixtures";

function writeContext(contextsDir: string, context: XCSHContext): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name, { mode: 0o644 });
}

function getContextSubcommand(name: string) {
	const contextCmd = BUILTIN_SLASH_COMMAND_DEFS.find(c => c.name === "context");
	if (!contextCmd?.subcommands) throw new Error("context command not found in registry");
	const sub = contextCmd.subcommands.find(s => s.name === name);
	if (!sub) throw new Error(`subcommand '${name}' not found under /context`);
	return sub;
}

function getContextTopLevelCompletions(prefix: string) {
	const contextCmd = BUILTIN_SLASH_COMMANDS.find(c => c.name === "context");
	if (!contextCmd?.getArgumentCompletions) throw new Error("context command has no getArgumentCompletions");
	return contextCmd.getArgumentCompletions(prefix);
}

describe("/context activate completion", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-completion", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
	});

	it("returns items for each cached context with apiUrl in description", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const activate = getContextSubcommand("activate");
		const items = activate.getArgumentCompletions!("");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["production", "staging"]);
		const prod = items!.find(i => i.label === "production");
		expect(prod?.description).toContain(TEST_CONTEXT.apiUrl);
	});

	it("filters case-insensitively by prefix", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const activate = getContextSubcommand("activate");
		const items = activate.getArgumentCompletions!("P");
		expect(items?.map(i => i.label)).toEqual(["production"]);
	});

	it("incompatible context gets 'incompatible: v2' in description", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT_INCOMPATIBLE);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const activate = getContextSubcommand("activate");
		const items = activate.getArgumentCompletions!("");
		expect(items?.[0]?.description).toContain("incompatible: v2");
	});

	it("returns null when no context name matches", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const activate = getContextSubcommand("activate");
		expect(activate.getArgumentCompletions!("zz")).toBeNull();
	});

	it("returns null once the prefix contains a space (past-argument boundary)", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const activate = getContextSubcommand("activate");
		expect(activate.getArgumentCompletions!("production ")).toBeNull();
	});

	it("returns null when ContextService is not initialized (no throw)", () => {
		// Do NOT call ContextService.init. tryGetContextService will see .instance throw.
		const activate = getContextSubcommand("activate");
		expect(() => activate.getArgumentCompletions!("")).not.toThrow();
		expect(activate.getArgumentCompletions!("")).toBeNull();
	});
});

describe("/context unset completion", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-completion-unset", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
	});

	async function setupWithEnvContext() {
		writeContext(xcshContextsDir, TEST_CONTEXT_WITH_ENV);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT_WITH_ENV.name);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();
		return service;
	}

	it("returns null when there is no active context", () => {
		ContextService.init(xcshConfigDir); // no loadActive()
		const unset = getContextSubcommand("unset");
		expect(unset.getArgumentCompletions!("")).toBeNull();
	});

	it("returns all env keys sorted when prefix is empty", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		const items = unset.getArgumentCompletions!("");
		expect(items).not.toBeNull();
		const keys = [...Object.keys(TEST_CONTEXT_WITH_ENV.env)].sort();
		expect(items!.map(i => i.label)).toEqual(keys);
	});

	it("filters case-insensitively by prefix on the last word", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		const items = unset.getArgumentCompletions!("xcsh_em");
		expect(items?.map(i => i.label)).toEqual(["XCSH_EMAIL"]);
	});

	it("excludes already-typed keys from the dropdown (multi-key flow)", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		const items = unset.getArgumentCompletions!("XCSH_EMAIL ");
		const labels = items?.map(i => i.label) ?? [];
		expect(labels).not.toContain("XCSH_EMAIL");
		expect(labels.length).toBe(Object.keys(TEST_CONTEXT_WITH_ENV.env).length - 1);
	});

	it("mixed-case already-typed keys still excluded from the dropdown (case-insensitive dedup)", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		// User typed a key in lowercase before hitting tab — the dedup must still
		// recognise it against the uppercase keys returned by getActiveEnvKeys().
		const items = unset.getArgumentCompletions!("xcsh_email ");
		const labels = items?.map(i => i.label) ?? [];
		expect(labels).not.toContain("XCSH_EMAIL");
	});

	it("value for multi-key mode preserves head so infra prepending produces the correct full argument", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		const items = unset.getArgumentCompletions!("XCSH_EMAIL XCSH_USER");
		const pick = items?.find(i => i.label === "XCSH_USERNAME");
		expect(pick).toBeDefined();
		// Provider-scoped value: "XCSH_EMAIL XCSH_USERNAME ". Infra layer prepends "unset ".
		expect(pick!.value).toBe("XCSH_EMAIL XCSH_USERNAME ");
	});

	it("normalizes mixed-case already-typed tokens to canonical env-key case", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		// User typed XCSH_EMAIL in lowercase. unsetEnvVars matches case-sensitively
		// (`key in env`), so a lowercase token would silently be skipped. The provider
		// must rewrite the head to the canonical case before infra prepends.
		const items = unset.getArgumentCompletions!("xcsh_email XCSH_USER");
		const pick = items?.find(i => i.label === "XCSH_USERNAME");
		expect(pick).toBeDefined();
		expect(pick!.value).toBe("XCSH_EMAIL XCSH_USERNAME ");
	});

	it("unknown already-typed tokens are preserved as-typed (user mistyped, handler reports no-op)", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		// NOPE_KEY isn't in the active context's env. The provider has nothing to
		// normalize it to, so it leaves the token exactly as the user typed. The
		// handler will report "No matching variables found" rather than silently
		// replacing the typo with a real key.
		const items = unset.getArgumentCompletions!("NOPE_KEY XCSH_LB");
		const pick = items?.find(i => i.label === "XCSH_LB_NAME");
		expect(pick).toBeDefined();
		expect(pick!.value).toBe("NOPE_KEY XCSH_LB_NAME ");
	});

	it("returns null when every known env key has been typed already", async () => {
		await setupWithEnvContext();
		const unset = getContextSubcommand("unset");
		const allKeys = Object.keys(TEST_CONTEXT_WITH_ENV.env).join(" ");
		expect(unset.getArgumentCompletions!(`${allKeys} `)).toBeNull();
	});

	it("returns null when ContextService is not initialized (no throw)", () => {
		// Do NOT call ContextService.init. tryGetContextService sees .instance throw.
		const unset = getContextSubcommand("unset");
		expect(() => unset.getArgumentCompletions!("")).not.toThrow();
		expect(unset.getArgumentCompletions!("")).toBeNull();
	});

	it("ambiguous lowercase token (maps to multiple case-distinct keys) is preserved as-typed", async () => {
		// Context has Foo AND FOO. User types lowercase `foo` — which variant
		// did they mean? Neither is a safe auto-pick. Provider must leave the
		// token as-typed so the handler's case-sensitive match fails cleanly
		// instead of silently removing whichever one appeared first in the
		// sorted key list.
		const caseDistinctContext: XCSHContext = {
			name: "ambig",
			apiUrl: TEST_CONTEXT.apiUrl,
			apiToken: TEST_CONTEXT.apiToken,
			defaultNamespace: TEST_CONTEXT.defaultNamespace,
			env: { Foo: "x", FOO: "y" },
		};
		writeContext(xcshContextsDir, caseDistinctContext);
		writeActiveContext(xcshConfigDir, caseDistinctContext.name);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const unset = getContextSubcommand("unset");
		const items = unset.getArgumentCompletions!("foo B");
		// No second key starts with B in this tiny fixture, so no dropdown —
		// but the important check is that if it were to produce items, the
		// head would carry lowercase `foo` verbatim. Force a match by seeding
		// a Bar-like key:
		const withBar: XCSHContext = {
			...caseDistinctContext,
			name: "ambig2",
			env: { ...caseDistinctContext.env, Bar: "z" },
		};
		writeContext(xcshContextsDir, withBar);
		await service.activate(withBar.name);

		const items2 = unset.getArgumentCompletions!("foo B");
		const pick = items2?.find(i => i.label === "Bar");
		expect(pick).toBeDefined();
		// Ambiguous `foo` preserved as-typed (not normalized to Foo or FOO).
		expect(pick!.value).toBe("foo Bar ");
		// Both Foo and FOO should also remain offered when the tail matches them
		// (they're not deduped because `foo` didn't bind to a canonical).
		expect(items).toBeNull(); // sanity: no B-prefixed key in first fixture
	});

	it("preserves case-distinct env keys — exact-case typed token keeps the other variant targetable", async () => {
		// Hypothetical context with two keys that differ only by case. unsetEnvVars
		// treats them as separate entries (`Foo in env` vs `FOO in env`). The
		// completion must NOT: (a) rewrite the user's token to the wrong case, or
		// (b) hide the other variant from the dropdown.
		const caseDistinctContext: XCSHContext = {
			name: "case-distinct",
			apiUrl: TEST_CONTEXT.apiUrl,
			apiToken: TEST_CONTEXT.apiToken,
			defaultNamespace: TEST_CONTEXT.defaultNamespace,
			env: { Foo: "x", FOO: "y" },
		};
		writeContext(xcshContextsDir, caseDistinctContext);
		writeActiveContext(xcshConfigDir, caseDistinctContext.name);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const unset = getContextSubcommand("unset");
		// User typed exact-case Foo. Head must preserve it verbatim, FOO must
		// remain available in the dropdown.
		const items = unset.getArgumentCompletions!("Foo F");
		const labels = items?.map(i => i.label) ?? [];
		expect(labels).toContain("FOO");
		expect(labels).not.toContain("Foo");
		const pickFOO = items?.find(i => i.label === "FOO");
		expect(pickFOO?.value).toBe("Foo FOO ");
	});
});

describe("/context namespace completion", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;
	let savedFetch: typeof globalThis.fetch;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-completion-ns", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
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
		ContextService._resetForTest();
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

	// validateToken's cache population is fire-and-forget; wait for the body-parse
	// microtask chain to settle before asserting dropdown state.
	function waitForCachePopulate(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 10));
	}

	async function setupWithActiveContextAndCache(namespaces: string[]): Promise<ContextService> {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
		globalThis.fetch = mockNamespaceFetch(namespaces);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();
		await service.validateToken(); // no explicit creds — active context path populates cache
		await waitForCachePopulate();
		return service;
	}

	it("returns null when namespace cache is empty", () => {
		ContextService.init(xcshConfigDir);
		const ns = getContextSubcommand("namespace");
		expect(ns.getArgumentCompletions!("")).toBeNull();
	});

	it("returns cached namespace items with empty prefix", async () => {
		await setupWithActiveContextAndCache(["ns1", "ns2", "production"]);
		const ns = getContextSubcommand("namespace");
		const items = ns.getArgumentCompletions!("");
		expect(items?.map(i => i.label)).toEqual(["ns1", "ns2", "production"]);
	});

	it("filters case-insensitively by prefix", async () => {
		await setupWithActiveContextAndCache(["ns1", "ns2", "production"]);
		const ns = getContextSubcommand("namespace");
		const items = ns.getArgumentCompletions!("Ns");
		expect(items?.map(i => i.label)).toEqual(["ns1", "ns2"]);
	});

	it("returns null once prefix contains a space (past-argument boundary)", async () => {
		await setupWithActiveContextAndCache(["ns1"]);
		const ns = getContextSubcommand("namespace");
		expect(ns.getArgumentCompletions!("ns1 ")).toBeNull();
	});

	it("returns null when prefix matches no cached namespace", async () => {
		await setupWithActiveContextAndCache(["ns1", "ns2"]);
		const ns = getContextSubcommand("namespace");
		expect(ns.getArgumentCompletions!("xyz")).toBeNull();
	});

	it("returns null when ContextService is not initialized (no throw)", () => {
		// Do NOT call ContextService.init. tryGetContextService will see .instance throw.
		const ns = getContextSubcommand("namespace");
		expect(() => ns.getArgumentCompletions!("")).not.toThrow();
		expect(ns.getArgumentCompletions!("")).toBeNull();
	});

	it("returns null in env-backed session (no active context) even if validateToken ran at startup", async () => {
		// Simulates the env-backed scenario Codex flagged: startup runs validateToken
		// against env-provided credentials, but there is no active context to apply
		// namespaces to. The cache must stay empty (new guard in validateToken) AND
		// the provider must reject completions (defense-in-depth guard in provider).
		globalThis.fetch = mockNamespaceFetch(["ns-from-env"]);
		const service = ContextService.init(xcshConfigDir);
		await service.validateToken(); // no active context
		await waitForCachePopulate();
		expect(service.getCachedNamespaces()).toEqual([]); // guard in validateToken
		const ns = getContextSubcommand("namespace");
		expect(ns.getArgumentCompletions!("")).toBeNull(); // guard in provider
	});
});

describe("/context validate completion", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-completion-validate", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
	});

	it("returns items for each cached context with apiUrl in description", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const validate = getContextSubcommand("validate");
		const items = validate.getArgumentCompletions!("");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["production", "staging"]);
	});

	it("filters case-insensitively by prefix", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const validate = getContextSubcommand("validate");
		const items = validate.getArgumentCompletions!("P");
		expect(items?.map(i => i.label)).toEqual(["production"]);
	});

	it("returns null once the prefix contains a space (single-arg boundary)", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const validate = getContextSubcommand("validate");
		expect(validate.getArgumentCompletions!("production ")).toBeNull();
	});

	it("returns null when ContextService is not initialized", () => {
		const validate = getContextSubcommand("validate");
		expect(() => validate.getArgumentCompletions!("")).not.toThrow();
		expect(validate.getArgumentCompletions!("")).toBeNull();
	});
});

describe("/context rename completion", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-completion-rename", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
	});

	it("offers context names on the first arg", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const rename = getContextSubcommand("rename");
		const items = rename.getArgumentCompletions!("");
		expect(items!.map(i => i.label)).toEqual(["production", "staging"]);
	});

	it("returns null once the first arg is typed (second slot is user's choice)", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const rename = getContextSubcommand("rename");
		expect(rename.getArgumentCompletions!("production ")).toBeNull();
	});
});

describe("/context export completion", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-completion-export", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
	});

	it("offers context names plus --include-token on an empty prefix", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		const items = exportCmd.getArgumentCompletions!("");
		expect(items).not.toBeNull();
		const labels = items!.map(i => i.label);
		expect(labels).toContain("production");
		expect(labels).toContain("staging");
		expect(labels).toContain("--include-token");
	});

	it("offers only --include-token once a positional name is typed", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		const items = exportCmd.getArgumentCompletions!("production ");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["--include-token"]);
	});

	it("preserves the positional in the --include-token completion value", async () => {
		// Regression: getArgumentCompletions.value replaces the whole argument
		// tail. If value is bare "--include-token", accepting the completion
		// after "/context export production " rewrites the line to
		// "/context export --include-token" — dropping "production" and turning
		// a single-context export into an all-context export with unmasked
		// tokens. Value must include the typed positional as a prefix, matching
		// the contract in SubcommandDef.getArgumentCompletions.
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		const items = exportCmd.getArgumentCompletions!("production ");
		expect(items).not.toBeNull();
		const flagItem = items!.find(i => i.label === "--include-token");
		expect(flagItem?.value).toBe("production --include-token");
	});

	it("preserves prefix flag when typing the positional after --include-token", async () => {
		// Mirror case: user typed "--include-token " first, then a partial name
		// like "prod". Context-name completions must preserve the flag.
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		const items = exportCmd.getArgumentCompletions!("--include-token prod");
		const nameItem = items?.find(i => i.label === "production");
		expect(nameItem?.value).toBe("--include-token production");
	});

	it("offers leading-dash context names as completions", async () => {
		// Regression: context names allow leading dashes (regex
		// /^[a-zA-Z0-9_-]{1,64}$/), and splitArgs's known-flags allowlist
		// means the handler correctly treats a name like `--prod` as a
		// positional. The completion must not diverge from that contract
		// by refusing to offer `--`-prefixed names.
		const prefixedContext = { ...TEST_CONTEXT, name: "--prod" };
		writeContext(xcshContextsDir, prefixedContext);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		// Typing `--p` should offer the leading-dash context by prefix match.
		const items = exportCmd.getArgumentCompletions!("--p");
		expect(items).not.toBeNull();
		const labels = items!.map(i => i.label);
		expect(labels).toContain("--prod");
	});

	it("still offers --include-token when the flag prefix is ambiguous", async () => {
		// With the leading-dash guard removed, typing `--in` could match both
		// a hypothetical context and the --include-token flag. Both branches
		// filter by prefix independently — ensure the flag suggestion still
		// appears when the typed prefix matches it.
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		const items = exportCmd.getArgumentCompletions!("--in");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toContain("--include-token");
	});

	it("returns null when --include-token is already present", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const exportCmd = getContextSubcommand("export");
		expect(exportCmd.getArgumentCompletions!("production --include-token ")).toBeNull();
	});
});

describe("/context mixed completions", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-context-mixed-completion", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
	});

	it("shows context names first, then dash-previous, then subcommands", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();
		await service.activate(TEST_CONTEXT_STAGING.name);

		const items = getContextTopLevelCompletions("");
		expect(items).not.toBeNull();
		const labels = items!.map(i => i.label);
		const prodIdx = labels.indexOf("production");
		const stagingIdx = labels.indexOf("staging");
		const dashIdx = labels.indexOf("-");
		const listIdx = labels.indexOf("list");
		expect(prodIdx).toBeGreaterThanOrEqual(0);
		expect(stagingIdx).toBeGreaterThanOrEqual(0);
		expect(dashIdx).toBeGreaterThan(stagingIdx);
		expect(listIdx).toBeGreaterThan(dashIdx);
	});

	it("omits dash-previous when no previous context exists", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const items = getContextTopLevelCompletions("");
		expect(items).not.toBeNull();
		const labels = items!.map(i => i.label);
		expect(labels).not.toContain("-");
		expect(labels).toContain("production");
		expect(labels).toContain("list");
	});

	it("filters by prefix across both context names and subcommands", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const items = getContextTopLevelCompletions("s");
		expect(items).not.toBeNull();
		const labels = items!.map(i => i.label);
		expect(labels).toContain("staging");
		expect(labels).toContain("show");
		expect(labels).toContain("status");
		expect(labels).toContain("set");
		expect(labels).not.toContain("production");
		expect(labels).not.toContain("list");
	});

	it("delegates to subcommand completion when space is present", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, TEST_CONTEXT_STAGING);
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const items = getContextTopLevelCompletions("activate ");
		expect(items).not.toBeNull();
		const labels = items!.map(i => i.label);
		expect(labels).toContain("production");
		expect(labels).toContain("staging");
		expect(labels).not.toContain("list");
	});
});
