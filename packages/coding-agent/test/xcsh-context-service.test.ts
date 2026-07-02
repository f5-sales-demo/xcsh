import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { ContextError, ContextService, type XCSHContext } from "@f5-sales-demo/xcsh/services/xcsh-context";
import {
	TEST_CONTEXT as _TEST_CONTEXT,
	TEST_CONTEXT_STAGING as _TEST_CONTEXT_STAGING,
	TEST_CONTEXT_INCOMPATIBLE,
	TEST_CONTEXT_WITH_ENV,
} from "./xcsh-test-fixtures";

const TEST_CONTEXT: XCSHContext = { ..._TEST_CONTEXT };
const TEST_CONTEXT_2: XCSHContext = { ..._TEST_CONTEXT_STAGING };
const TEST_CONTEXT_ENV: XCSHContext = { ...TEST_CONTEXT_WITH_ENV };
const TEST_CONTEXT_INCOMPAT: XCSHContext = { ...TEST_CONTEXT_INCOMPATIBLE };

function writeContext(contextsDir: string, context: XCSHContext): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name, { mode: 0o644 });
}

describe("ContextService", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		// Save and delete ALL XCSH_* env vars to prevent container env leakage
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) {
				savedEnv[key] = process.env[key];
				delete process.env[key];
			}
		}
		savedEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-xcsh-context", Snowflake.next());
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
		_resetSettingsForTest();
		ContextService._resetForTest();
		// Restore ALL XCSH_* env vars
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
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
			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
		});

		it("returns null when active_context file is missing", async () => {
			fs.mkdirSync(xcshConfigDir, { recursive: true });
			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
		});

		it("returns context when valid active_context and JSON exist", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.name).toBe(TEST_CONTEXT.name);
			expect(result?.apiUrl).toBe(TEST_CONTEXT.apiUrl);
			expect(result?.apiToken).toBe(TEST_CONTEXT.apiToken);
		});

		it("injects credentials into bash.environment settings override", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_API_URL).toBe(TEST_CONTEXT.apiUrl);
			expect(bashEnv.XCSH_API_TOKEN).toBe(TEST_CONTEXT.apiToken);
			expect(bashEnv.XCSH_NAMESPACE).toBe(TEST_CONTEXT.defaultNamespace);
		});

		it("returns null when XCSH_API_URL is set (env override skips context)", async () => {
			process.env.XCSH_API_URL = "https://env-override.console.ves.volterra.io";
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
			expect(service.getStatus().credentialSource).toBe("environment");
		});

		it("loads context values into bash.environment (env vars inherited separately via process.env)", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_API_URL).toBe(TEST_CONTEXT.apiUrl);
			expect(bashEnv.XCSH_API_TOKEN).toBe(TEST_CONTEXT.apiToken);
			expect(bashEnv.XCSH_NAMESPACE).toBe(TEST_CONTEXT.defaultNamespace);
		});

		it("auto-activates the single context when no active_context exists", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			// No active_context file

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.name).toBe(TEST_CONTEXT.name);

			// Should have written active_context
			const written = fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8");
			expect(written).toBe(TEST_CONTEXT.name);
		});

		it("does not auto-activate when multiple contexts exist", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			// No active_context file

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("returns null gracefully on invalid JSON", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(path.join(xcshContextsDir, "broken.json"), "not json{{{");
			writeActiveContext(xcshConfigDir, "broken");

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("rejects context with non-string field types", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "bad-types.json"),
				JSON.stringify({ apiUrl: 123, apiToken: true, defaultNamespace: {} }),
			);
			writeActiveContext(xcshConfigDir, "bad-types");

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("uses filename as context name, ignoring parsed.name", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "my-file.json"),
				JSON.stringify({
					name: "different-name",
					apiUrl: "https://test.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
				}),
			);
			writeActiveContext(xcshConfigDir, "my-file");

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.name).toBe("my-file");
		});

		it("does not write active_context when auto-activated context is invalid", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(path.join(xcshContextsDir, "bad.json"), "not valid json{{{");
			// No active_context file, one broken context

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
			// active_context should NOT have been written
			expect(fs.existsSync(path.join(xcshConfigDir, "active_context"))).toBe(false);
		});

		it("T-005: returns null when active_context references non-existent JSON", async () => {
			fs.mkdirSync(xcshConfigDir, { recursive: true });
			// active_context points to a context that doesn't exist
			writeActiveContext(xcshConfigDir, "vanished");

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
			expect(service.getStatus().credentialSource).toBe("none");
			// No XCSH vars should be in bash.environment
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_API_URL).toBeUndefined();
		});

		it("per-field env merge: XCSH_API_TOKEN in env skips token injection", async () => {
			process.env.XCSH_API_TOKEN = "env-token-override";
			// XCSH_API_URL is NOT set — context should load
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// URL should be injected from context (not in process.env)
			expect(bashEnv.XCSH_API_URL).toBe(TEST_CONTEXT.apiUrl);
			// Token should NOT be injected (already in process.env)
			expect(bashEnv.XCSH_API_TOKEN).toBeUndefined();
			// Namespace should be injected from context
			expect(bashEnv.XCSH_NAMESPACE).toBe(TEST_CONTEXT.defaultNamespace);
		});

		it("rejects active_context with path traversal content", async () => {
			fs.mkdirSync(xcshConfigDir, { recursive: true });
			writeActiveContext(xcshConfigDir, "../../etc/shadow");

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});

		it("returns null gracefully when context missing required fields", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(path.join(xcshContextsDir, "incomplete.json"), JSON.stringify({ name: "incomplete" }));
			writeActiveContext(xcshConfigDir, "incomplete");

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).toBeNull();
		});
	});

	describe("listContexts", () => {
		it("returns all contexts from contexts directory", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);

			const service = ContextService.init(xcshConfigDir);
			const contexts = await service.listContexts();

			expect(contexts.length).toBe(2);
			const names = contexts.map(p => p.name).sort();
			expect(names).toEqual(["production", "staging"]);
		});

		it("returns empty array when contexts directory does not exist", async () => {
			const service = ContextService.init(xcshConfigDir);
			const contexts = await service.listContexts();
			expect(contexts).toEqual([]);
		});
	});

	describe("activate", () => {
		it("updates in-memory state and settings without writing active_context (session log is source of truth)", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const result = await service.activate(TEST_CONTEXT_2.name);
			expect(result.name).toBe(TEST_CONTEXT_2.name);

			// active_context file must NOT be updated — session log is now the sole binding record
			const onDisk = fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8");
			expect(onDisk).toBe(TEST_CONTEXT.name);

			// in-memory state reflects the new context
			expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT_2.name);

			// settings should reflect new context
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_API_URL).toBe(TEST_CONTEXT_2.apiUrl);
		});

		it("rejects context names with path separators", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			const service = ContextService.init(xcshConfigDir);
			await expect(service.activate("../../etc/passwd")).rejects.toThrow(/Invalid context name/);
			await expect(service.activate("../escape")).rejects.toThrow(/Invalid context name/);
			await expect(service.activate("sub/dir")).rejects.toThrow(/Invalid context name/);
			await expect(service.activate("has..dots")).rejects.toThrow(/Invalid context name/);
		});

		it("throws ContextError when context does not exist", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });

			const service = ContextService.init(xcshConfigDir);
			await expect(service.activate("nonexistent")).rejects.toThrow(ContextError);
		});

		it("T-017: does not update active_context when context JSON is missing", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			// Try to activate a context that doesn't exist
			await expect(service.activate("missing")).rejects.toThrow(ContextError);

			// active_context should still point to original context
			const active = fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8");
			expect(active).toBe(TEST_CONTEXT.name);
		});

		it("rejects activation when XCSH_API_URL is in environment", async () => {
			process.env.XCSH_API_URL = "https://env.console.ves.volterra.io";
			writeContext(xcshContextsDir, TEST_CONTEXT);

			const service = ContextService.init(xcshConfigDir);
			await expect(service.activate(TEST_CONTEXT.name)).rejects.toThrow(/Cannot activate/);
		});

		it("rejects empty context name", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.activate("")).rejects.toThrow(/Invalid context name/);
		});

		it("rejects activation when XCSH_API_URL set — error cites unset command", async () => {
			process.env.XCSH_API_URL = "https://env.console.ves.volterra.io";
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			const err = await service.activate(TEST_CONTEXT.name).catch(e => e);
			expect(err.message).toContain("unset XCSH_API_URL");
			expect(err.message).not.toContain("/context env");
		});

		it("context not found error cites /context list", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			const service = ContextService.init(xcshConfigDir);
			const err = await service.activate("ghost").catch(e => e);
			expect(err.message).toContain("ghost");
			expect(err.message).toContain("/context list");
		});
	});

	describe("setNamespace", () => {
		it("setNamespace error cites /context activate", () => {
			const service = ContextService.init(xcshConfigDir);
			let err: Error | null = null;
			try {
				service.setNamespace("ns");
			} catch (e) {
				err = e as Error;
			}
			expect(err?.message).toContain("/context activate");
		});
	});

	describe("getStatus", () => {
		it("returns correct state after loadActive", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const status = service.getStatus();
			expect(status.activeContextName).toBe(TEST_CONTEXT.name);
			expect(status.activeContextUrl).toBe(TEST_CONTEXT.apiUrl);
			expect(status.credentialSource).toBe("context");
			expect(status.isConfigured).toBe(true);
		});

		it("returns none state when no context loaded", async () => {
			const service = ContextService.init(xcshConfigDir);
			const status = service.getStatus();
			expect(status.activeContextName).toBeNull();
			expect(status.credentialSource).toBe("none");
			expect(status.isConfigured).toBe(false);
		});

		it("reports environment source when all env vars are set", async () => {
			process.env.XCSH_API_URL = "https://env.console.ves.volterra.io";
			process.env.XCSH_API_TOKEN = "env-token-value";

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const status = service.getStatus();
			expect(status.credentialSource).toBe("environment");
		});

		it("loads context normally when only XCSH_API_TOKEN is set (not URL)", async () => {
			process.env.XCSH_API_TOKEN = "env-token-only";
			// XCSH_API_URL not set — context should load; env token inherited by subprocess via process.env
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			// Mixed: URL from context, token from env
			expect(service.getStatus().credentialSource).toBe("mixed");
		});

		it("reports mixed source when XCSH_NAMESPACE is in env but rest from context", async () => {
			process.env.XCSH_NAMESPACE = "env-namespace";
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			expect(service.getStatus().credentialSource).toBe("mixed");
		});
	});

	describe("createContext", () => {
		it("creates context JSON file with correct content", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "new-prof",
				apiUrl: "https://new.console.ves.volterra.io",
				apiToken: "tok-create-test",
				defaultNamespace: "ns1",
			});

			const filePath = path.join(xcshContextsDir, "new-prof.json");
			expect(fs.existsSync(filePath)).toBe(true);
			const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			expect(data.apiUrl).toBe("https://new.console.ves.volterra.io");
			expect(data.apiToken).toBe("tok-create-test");
			expect(data.defaultNamespace).toBe("ns1");
			expect(data.metadata?.createdAt).toBeDefined();
			// createdAt should be a valid ISO date string
			expect(Number.isNaN(Date.parse(data.metadata.createdAt))).toBe(false);
		});

		it("persists env + sensitiveKeys (web-console credentials from the wizard)", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "auth-prof",
				apiUrl: "https://auth.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "system",
				env: { XCSH_USERNAME: "console-user@example.com", XCSH_CONSOLE_PASSWORD: "s3cret" },
				sensitiveKeys: ["XCSH_CONSOLE_PASSWORD"],
			});

			const data = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, "auth-prof.json"), "utf-8"));
			expect(data.env).toEqual({ XCSH_USERNAME: "console-user@example.com", XCSH_CONSOLE_PASSWORD: "s3cret" });
			expect(data.sensitiveKeys).toEqual(["XCSH_CONSOLE_PASSWORD"]);

			// And it round-trips back through the service loader.
			const loaded = (await service.listContexts()).find(c => c.name === "auth-prof");
			expect(loaded?.env?.XCSH_USERNAME).toBe("console-user@example.com");
			expect(loaded?.sensitiveKeys).toEqual(["XCSH_CONSOLE_PASSWORD"]);
		});

		it("normalizes a pasted full URL to its origin on create", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "pasted-prof",
				apiUrl: "https://new.console.ves.volterra.io/web/home?iss=https%3A%2F%2Flogin.example%2Frealms%2Fx",
				apiToken: "tok",
				defaultNamespace: "ns1",
			});

			const data = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, "pasted-prof.json"), "utf-8"));
			expect(data.apiUrl).toBe("https://new.console.ves.volterra.io");
		});

		it("creates contexts directory if it does not exist", async () => {
			expect(fs.existsSync(xcshContextsDir)).toBe(false);

			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "first",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			expect(fs.existsSync(xcshContextsDir)).toBe(true);
		});

		it("writes context file with 0o600 permissions", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "perms-test",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			const stat = fs.statSync(path.join(xcshContextsDir, "perms-test.json"));
			expect(stat.mode & 0o777).toBe(0o600);
		});

		it("rejects duplicate context name", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);

			const service = ContextService.init(xcshConfigDir);
			await expect(
				service.createContext({
					name: TEST_CONTEXT.name,
					apiUrl: "https://x.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
				}),
			).rejects.toThrow(/already exists/);
		});

		it("rejects context name with path traversal", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(
				service.createContext({
					name: "../../etc/passwd",
					apiUrl: "https://x.io",
					apiToken: "t",
					defaultNamespace: "d",
				}),
			).rejects.toThrow(/Invalid context name/);
		});

		it("rejects empty context name", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(
				service.createContext({ name: "", apiUrl: "https://x.io", apiToken: "t", defaultNamespace: "d" }),
			).rejects.toThrow(/Invalid context name/);
		});

		it("rejects context name longer than 64 chars", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(
				service.createContext({
					name: "a".repeat(65),
					apiUrl: "https://x.io",
					apiToken: "t",
					defaultNamespace: "d",
				}),
			).rejects.toThrow(/Invalid context name/);
		});

		it("uses atomic write (no .tmp file remains after success)", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "atomic-test",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			expect(fs.existsSync(path.join(xcshContextsDir, "atomic-test.json"))).toBe(true);
			expect(fs.existsSync(path.join(xcshContextsDir, "atomic-test.json.tmp"))).toBe(false);
		});

		it("rejects a reserved subcommand name", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(
				service.createContext({
					name: "list",
					apiUrl: "https://t.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
				}),
			).rejects.toThrow(/conflicts with a \/context subcommand/);
		});

		it("rejects reserved names case-insensitively", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(
				service.createContext({
					name: "CREATE",
					apiUrl: "https://t.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
				}),
			).rejects.toThrow(/conflicts with a \/context subcommand/);
		});

		it("allows a name that contains a reserved word as a substring", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "my-list",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});
			expect(fs.existsSync(path.join(xcshContextsDir, "my-list.json"))).toBe(true);
		});

		it("createContext() writes $schema pointer into the JSON file", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "schema-test",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});

			const raw = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, "schema-test.json"), "utf-8"));
			expect(raw.$schema).toBeDefined();
			expect(typeof raw.$schema).toBe("string");
			expect(raw.$schema).toContain("context-schema.json");
		});
	});

	describe("deleteContext", () => {
		it("deletes existing context JSON file", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const filePath = path.join(xcshContextsDir, `${TEST_CONTEXT_2.name}.json`);
			expect(fs.existsSync(filePath)).toBe(true);

			const service = ContextService.init(xcshConfigDir);
			await service.deleteContext(TEST_CONTEXT_2.name);

			expect(fs.existsSync(filePath)).toBe(false);
		});

		it("throws ContextError for non-existent context", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			const service = ContextService.init(xcshConfigDir);
			await expect(service.deleteContext("ghost")).rejects.toThrow(/not found/);
		});

		it("rejects context name with path traversal", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.deleteContext("../escape")).rejects.toThrow(/Invalid context name/);
		});

		it("rejects empty context name", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.deleteContext("")).rejects.toThrow(/Invalid context name/);
		});

		it("does not affect active_context file", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.deleteContext(TEST_CONTEXT_2.name);

			// active_context still points to production
			const active = fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8");
			expect(active).toBe(TEST_CONTEXT.name);
		});
	});

	describe("env map and tenant derivation", () => {
		it("loadActive injects env map vars into bash.environment", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_ENV);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT_ENV.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_EMAIL).toBe("test@example.com");
			expect(bashEnv.XCSH_USERNAME).toBe("exampleuser@example.com");
			expect(bashEnv.XCSH_CONSOLE_PASSWORD).toBe("test-console-pass");
			expect(bashEnv.XCSH_LB_NAME).toBe("test-lb");
			expect(bashEnv.XCSH_DOMAINNAME).toBe("test.example.com");
			expect(bashEnv.XCSH_ROOT_DOMAIN).toBe("example.com");
		});

		it("never injects process-hijacking env keys from a context", async () => {
			const malicious: XCSHContext = {
				...TEST_CONTEXT,
				name: "malicious",
				env: {
					LD_PRELOAD: "/tmp/evil.so",
					DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
					NODE_OPTIONS: "--require /tmp/evil.js",
					PATH: "/tmp/evil/bin",
					XCSH_SAFE: "ok",
				},
			};
			writeContext(xcshContextsDir, malicious);
			writeActiveContext(xcshConfigDir, malicious.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// Dangerous keys are dropped; benign XCSH_ vars still flow through.
			expect(bashEnv.LD_PRELOAD).toBeUndefined();
			expect(bashEnv.DYLD_INSERT_LIBRARIES).toBeUndefined();
			expect(bashEnv.NODE_OPTIONS).toBeUndefined();
			expect(bashEnv.PATH).toBeUndefined();
			expect(bashEnv.XCSH_SAFE).toBe("ok");
		});

		it("XCSH_TENANT is auto-derived from apiUrl hostname", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// TEST_XCSH_URL is https://test-tenant.console.ves.volterra.io
			expect(bashEnv.XCSH_TENANT).toBe("test-tenant");
		});

		it("env map vars respect per-field process.env precedence", async () => {
			process.env.XCSH_EMAIL = "env-email@override.com";
			writeContext(xcshContextsDir, TEST_CONTEXT_ENV);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT_ENV.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			// XCSH_EMAIL is in process.env — should NOT be overridden
			expect(bashEnv.XCSH_EMAIL).toBeUndefined();
			// Other env vars should be injected normally
			expect(bashEnv.XCSH_LB_NAME).toBe("test-lb");

			delete process.env.XCSH_EMAIL;
		});

		it("createContext stores env map in JSON", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "with-env",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
				env: { XCSH_LB_NAME: "my-lb", XCSH_EMAIL: "a@b.com" },
			});

			const data = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, "with-env.json"), "utf-8"));
			expect(data.env.XCSH_LB_NAME).toBe("my-lb");
			expect(data.env.XCSH_EMAIL).toBe("a@b.com");
		});

		it("getStatus includes tenant and namespace", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const status = service.getStatus();
			expect(status.activeContextTenant).toBe("test-tenant");
			expect(status.activeContextNamespace).toBe(TEST_CONTEXT.defaultNamespace);
		});

		it("context switch clears stale XCSH_* vars from previous context", async () => {
			// Production has XCSH_CONSOLE_PASSWORD in env map, staging does not
			const prodWithPass: XCSHContext = {
				...TEST_CONTEXT,
				env: { XCSH_CONSOLE_PASSWORD: "secret-pass", XCSH_LB_NAME: "prod-lb" },
			};
			const stagingNoPass: XCSHContext = {
				...TEST_CONTEXT_2,
				env: { XCSH_LB_NAME: "staging-lb" },
			};
			writeContext(xcshContextsDir, prodWithPass);
			writeContext(xcshContextsDir, stagingNoPass);
			writeActiveContext(xcshConfigDir, prodWithPass.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			// Verify production password is present
			let bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_CONSOLE_PASSWORD).toBe("secret-pass");
			expect(bashEnv.XCSH_LB_NAME).toBe("prod-lb");

			// Switch to staging — password must be CLEARED
			await service.activate(stagingNoPass.name);
			bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_CONSOLE_PASSWORD).toBeUndefined();
			expect(bashEnv.XCSH_LB_NAME).toBe("staging-lb");
		});

		it("setNamespace switches namespace in active context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			expect(service.getStatus().activeContextNamespace).toBe(TEST_CONTEXT.defaultNamespace);

			service.setNamespace("other-ns");

			expect(service.getStatus().activeContextNamespace).toBe("other-ns");
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_NAMESPACE).toBe("other-ns");
		});

		it("setNamespace throws when no active context", () => {
			const service = ContextService.init(xcshConfigDir);
			expect(() => service.setNamespace("test")).toThrow(/No active context/);
		});

		it("bash.environment uses defaultNamespace, not env.XCSH_NAMESPACE, after loading corrupted context", async () => {
			const corrupted = {
				name: "ns-guard",
				apiUrl: "https://test.console.ves.volterra.io",
				apiToken: "fake-token",
				defaultNamespace: "correct-ns",
				env: { XCSH_NAMESPACE: "wrong-ns" },
			};
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(path.join(xcshContextsDir, "ns-guard.json"), JSON.stringify(corrupted, null, 2), {
				mode: 0o600,
			});
			writeActiveContext(xcshConfigDir, "ns-guard");

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_NAMESPACE).toBe("correct-ns");
		});

		it("contexts without env field work unchanged (backward compat)", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();

			expect(result).not.toBeNull();
			expect(result?.env).toBeUndefined();
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_API_URL).toBe(TEST_CONTEXT.apiUrl);
			expect(bashEnv.XCSH_TENANT).toBe("test-tenant");
		});
	});

	describe("#validateContextShape() reserved key stripping", () => {
		it("strips XCSH_NAMESPACE from env when loading a corrupted context file", async () => {
			const corrupted = {
				name: "corrupted",
				apiUrl: "https://test.console.ves.volterra.io",
				apiToken: "fake-token",
				defaultNamespace: "my-namespace",
				env: {
					XCSH_NAMESPACE: "my-namespace",
					SAFE_KEY: "safe-value",
				},
			};
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(path.join(xcshContextsDir, "corrupted.json"), JSON.stringify(corrupted, null, 2), {
				mode: 0o600,
			});

			const service = ContextService.init(xcshConfigDir);
			const contexts = await service.listContexts();
			const loaded = contexts.find(c => c.name === "corrupted");
			expect(loaded).toBeDefined();
			expect(loaded?.env?.XCSH_NAMESPACE).toBeUndefined();
			expect(loaded?.env?.SAFE_KEY).toBe("safe-value");
		});

		it("strips all four reserved keys from env", async () => {
			const corrupted = {
				name: "all-reserved",
				apiUrl: "https://test.console.ves.volterra.io",
				apiToken: "fake-token",
				defaultNamespace: "my-namespace",
				env: {
					XCSH_NAMESPACE: "my-namespace",
					XCSH_API_URL: "https://test.console.ves.volterra.io",
					XCSH_API_TOKEN: "fake-token",
					XCSH_TENANT: "test",
					SAFE_KEY: "safe-value",
				},
			};
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(path.join(xcshContextsDir, "all-reserved.json"), JSON.stringify(corrupted, null, 2), {
				mode: 0o600,
			});

			const service = ContextService.init(xcshConfigDir);
			const contexts = await service.listContexts();
			const loaded = contexts.find(c => c.name === "all-reserved");
			expect(loaded?.env?.XCSH_NAMESPACE).toBeUndefined();
			expect(loaded?.env?.XCSH_API_URL).toBeUndefined();
			expect(loaded?.env?.XCSH_API_TOKEN).toBeUndefined();
			expect(loaded?.env?.XCSH_TENANT).toBeUndefined();
			expect(loaded?.env?.SAFE_KEY).toBe("safe-value");
		});

		it("emits logger.warn when env reserved key value differs from top-level field", async () => {
			const { logger } = await import("@f5-sales-demo/pi-utils");
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			try {
				const corrupted = {
					name: "mismatch",
					apiUrl: "https://test.console.ves.volterra.io",
					apiToken: "fake-token",
					defaultNamespace: "correct-namespace",
					env: {
						XCSH_NAMESPACE: "different-namespace",
					},
				};
				fs.mkdirSync(xcshContextsDir, { recursive: true });
				fs.writeFileSync(path.join(xcshContextsDir, "mismatch.json"), JSON.stringify(corrupted, null, 2), {
					mode: 0o600,
				});

				const service = ContextService.init(xcshConfigDir);
				await service.listContexts();

				// logger.warn is called as logger.warn("message", { name, key, envValue, topLevelValue })
				const reservedWarn = warnSpy.mock.calls.some(args => {
					const ctx = args[1] as Record<string, unknown> | undefined;
					return String(args[0]).includes("reserved key") && ctx?.key === "XCSH_NAMESPACE";
				});
				expect(reservedWarn).toBe(true);
			} finally {
				warnSpy.mockRestore();
			}
		});

		it("does NOT emit logger.warn when env reserved key value matches top-level field", async () => {
			const { logger } = await import("@f5-sales-demo/pi-utils");
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			try {
				const matching = {
					name: "matching",
					apiUrl: "https://test.console.ves.volterra.io",
					apiToken: "fake-token",
					defaultNamespace: "same-namespace",
					env: {
						XCSH_NAMESPACE: "same-namespace",
						SAFE_KEY: "ok",
					},
				};
				fs.mkdirSync(xcshContextsDir, { recursive: true });
				fs.writeFileSync(path.join(xcshContextsDir, "matching.json"), JSON.stringify(matching, null, 2), {
					mode: 0o600,
				});

				const service = ContextService.init(xcshConfigDir);
				await service.listContexts();

				// No warn for XCSH_NAMESPACE when values are identical (silent strip)
				const reservedWarn = warnSpy.mock.calls.some(args => {
					const ctx = args[1] as Record<string, unknown> | undefined;
					return String(args[0]).includes("reserved key") && ctx?.key === "XCSH_NAMESPACE";
				});
				expect(reservedWarn).toBe(false);
			} finally {
				warnSpy.mockRestore();
			}
		});
	});

	describe("maskToken", () => {
		it("masks all but last 4 characters", () => {
			const service = ContextService.init(xcshConfigDir);
			expect(service.maskToken(_TEST_CONTEXT.apiToken)).toBe(`...${_TEST_CONTEXT.apiToken.slice(-4)}`);
		});

		it("masks short tokens completely", () => {
			const service = ContextService.init(xcshConfigDir);
			expect(service.maskToken("abc")).toBe("****");
		});
	});

	describe("getOrInit", () => {
		it("returns the existing instance when already initialized", async () => {
			const first = ContextService.init(xcshConfigDir);
			const second = await ContextService.getOrInit(xcshConfigDir);
			expect(second).toBe(first);
		});

		it("bootstraps with the provided configDir when no instance exists", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			const service = await ContextService.getOrInit(xcshConfigDir);
			expect(service.contextsDir).toBe(xcshContextsDir);
			expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT.name);
		});

		it("falls back to getXCSHConfigDir() when configDir is omitted", async () => {
			process.env.XDG_CONFIG_HOME = testDir;
			const service = await ContextService.getOrInit();
			expect(service.contextsDir.startsWith(testDir)).toBe(true);
		});

		it("is idempotent under concurrent callers", async () => {
			const [a, b] = await Promise.all([
				ContextService.getOrInit(xcshConfigDir),
				ContextService.getOrInit(xcshConfigDir),
			]);
			expect(a).toBe(b);
		});
	});

	describe("schema version", () => {
		it("createContext writes version: 1 to disk", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.createContext({
				name: "versioned",
				apiUrl: "https://example.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			});
			const raw = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, "versioned.json"), "utf-8"));
			expect(raw.version).toBe(1);
		});

		it("reading a legacy context (no version field) succeeds", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "legacy.json"),
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
			writeActiveContext(xcshConfigDir, "legacy");
			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();
			expect(result).not.toBeNull();
			expect((result as XCSHContext).version).toBeUndefined();
		});

		it("reading a v1 context succeeds", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "v1.json"),
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
			writeActiveContext(xcshConfigDir, "v1");
			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();
			expect(result).not.toBeNull();
			expect((result as XCSHContext).version).toBe(1);
		});

		it("activate() rejects a v2 context with actionable error", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "future.json"),
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
			const service = ContextService.init(xcshConfigDir);
			await expect(service.activate("future")).rejects.toThrow(/schema version 2/);
			await expect(service.activate("future")).rejects.toThrow(/upgrade xcsh/i);
		});

		it("loadActive() returns null for a v2 context — does not crash startup", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "future.json"),
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
			writeActiveContext(xcshConfigDir, "future");
			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
		});

		it("loadActive() does NOT persist auto-activate for an incompatible context", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "future.json"),
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
			// No active_context file — triggers auto-activate path
			const service = ContextService.init(xcshConfigDir);
			const result = await service.loadActive();
			expect(result).toBeNull();
			expect(fs.existsSync(path.join(xcshConfigDir, "active_context"))).toBe(false);
		});

		it("setEnvVars() rejects a v2 context before write-back", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "future.json"),
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
			const service = ContextService.init(xcshConfigDir);
			await expect(service.setEnvVars("future", { MY_KEY: "val" })).rejects.toThrow(/schema version 2/);
		});

		it("unsetEnvVars() rejects a v2 context before write-back", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "future.json"),
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
			const service = ContextService.init(xcshConfigDir);
			await expect(service.unsetEnvVars("future", ["MY_KEY"])).rejects.toThrow(/schema version 2/);
		});

		it("listContexts() includes incompatible contexts (no gate)", async () => {
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "future.json"),
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
			const service = ContextService.init(xcshConfigDir);
			const contexts = await service.listContexts();
			expect(contexts.length).toBe(1);
			expect(contexts[0].version).toBe(2);
		});
	});

	describe("setEnvVars() reserved key enforcement", () => {
		it("throws ContextError for a single reserved key (XCSH_NAMESPACE)", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(service.setEnvVars(TEST_CONTEXT.name, { XCSH_NAMESPACE: "my-ns" })).rejects.toThrow(ContextError);
		});

		it("error message contains redirect for XCSH_NAMESPACE", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(service.setEnvVars(TEST_CONTEXT.name, { XCSH_NAMESPACE: "my-ns" })).rejects.toThrow(
				/Use \/context namespace/,
			);
		});

		it("throws ContextError for XCSH_API_URL", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(
				service.setEnvVars(TEST_CONTEXT.name, { XCSH_API_URL: "https://other.example.com" }),
			).rejects.toThrow(/managed by apiUrl/);
		});

		it("throws ContextError for XCSH_API_TOKEN", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(service.setEnvVars(TEST_CONTEXT.name, { XCSH_API_TOKEN: "new-token" })).rejects.toThrow(
				/managed by apiToken/,
			);
		});

		it("throws ContextError for XCSH_TENANT", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(service.setEnvVars(TEST_CONTEXT.name, { XCSH_TENANT: "my-tenant" })).rejects.toThrow(/read-only/);
		});

		it("collects all violations in a single error when multiple reserved keys passed", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			const err = await service
				.setEnvVars(TEST_CONTEXT.name, { XCSH_NAMESPACE: "x", XCSH_API_URL: "y", OTHER_KEY: "z" })
				.catch(e => e);
			expect(err).toBeInstanceOf(ContextError);
			expect(err.message).toContain("XCSH_NAMESPACE");
			expect(err.message).toContain("XCSH_API_URL");
		});

		it("does not write to disk when reserved key violation is thrown", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			const before = fs.readFileSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`), "utf-8");
			await service.setEnvVars(TEST_CONTEXT.name, { XCSH_NAMESPACE: "x", MY_KEY: "val" }).catch(() => {});
			const after = fs.readFileSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`), "utf-8");
			expect(after).toBe(before);
		});

		it("succeeds and writes when no reserved keys are present", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(service.setEnvVars(TEST_CONTEXT.name, { MY_CUSTOM_VAR: "val" })).resolves.toEqual({
				sensitive: [],
			});
			const data = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`), "utf-8"));
			expect(data.env.MY_CUSTOM_VAR).toBe("val");
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

		function makeMockResponse(status: number, headers?: Record<string, string>): typeof globalThis.fetch {
			const effectiveHeaders = headers ?? (status === 200 ? { "content-type": "application/json" } : {});
			const fn = () =>
				Promise.resolve(new Response(status === 200 ? "{}" : "err", { status, headers: effectiveHeaders }));
			return fn as unknown as typeof globalThis.fetch;
		}

		function makeNetworkError(): typeof globalThis.fetch {
			const fn = () => Promise.reject(new Error("network failure"));
			return fn as unknown as typeof globalThis.fetch;
		}

		function makeRedirectResponse(): typeof globalThis.fetch {
			const fn = () =>
				Promise.resolve({
					type: "opaqueredirect" as Response["type"],
					status: 0,
					ok: false,
					headers: new Headers(),
				} as unknown as Response);
			return fn as unknown as typeof globalThis.fetch;
		}

		it("200 response returns connected with latencyMs, no errorClass", async () => {
			globalThis.fetch = makeMockResponse(200);
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("connected");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBeUndefined();
		});

		it("401 response returns auth_error with errorClass: credential", async () => {
			globalThis.fetch = makeMockResponse(401);
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("auth_error");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("credential");
		});

		it("403 response returns auth_error with errorClass: credential", async () => {
			globalThis.fetch = makeMockResponse(403);
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("auth_error");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("credential");
		});

		it("500 response returns offline with errorClass: network and latencyMs (was 'connected')", async () => {
			globalThis.fetch = makeMockResponse(500);
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("network");
		});

		it("502 response returns offline with errorClass: network (was 'connected')", async () => {
			globalThis.fetch = makeMockResponse(502);
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("network");
		});

		it("429 response returns offline with errorClass: network", async () => {
			globalThis.fetch = makeMockResponse(429);
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("network");
		});

		it("network error returns offline with errorClass: network, no latencyMs", async () => {
			globalThis.fetch = makeNetworkError();
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeUndefined();
			expect(result.errorClass).toBe("network");
		});

		it("missing credentials returns unknown with no errorClass", async () => {
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({});
			expect(result.status).toBe("unknown");
			expect(result.errorClass).toBeUndefined();
		});

		it("redirect response returns offline with errorClass: url_not_found", async () => {
			globalThis.fetch = makeRedirectResponse();
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("url_not_found");
		});

		it("200 with non-JSON content-type returns offline with errorClass: url_not_found", async () => {
			globalThis.fetch = makeMockResponse(200, { "content-type": "text/html" });
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("offline");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBe("url_not_found");
		});

		it("200 with application/json charset variant returns connected", async () => {
			globalThis.fetch = makeMockResponse(200, { "content-type": "application/json; charset=utf-8" });
			const service = ContextService.init(xcshConfigDir);
			const result = await service.validateToken({ apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok" });
			expect(result.status).toBe("connected");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBeUndefined();
		});
	});

	describe("validateContextByName", () => {
		let savedFetch: typeof globalThis.fetch;

		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});

		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function makeMockResponse(status: number): typeof globalThis.fetch {
			const headers = status === 200 ? { "content-type": "application/json" } : {};
			const fn = () => Promise.resolve(new Response(status === 200 ? "{}" : "err", { status, headers }));
			return fn as unknown as typeof globalThis.fetch;
		}

		it("returns connected status for a valid context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			globalThis.fetch = makeMockResponse(200);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();

			const result = await service.validateContextByName(TEST_CONTEXT.name);
			expect(result.context.name).toBe(TEST_CONTEXT.name);
			expect(result.status).toBe("connected");
			expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			expect(result.errorClass).toBeUndefined();
		});

		it("returns auth_error with credential errorClass on 401", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			globalThis.fetch = makeMockResponse(401);
			const service = ContextService.init(xcshConfigDir);

			const result = await service.validateContextByName(TEST_CONTEXT.name);
			expect(result.status).toBe("auth_error");
			expect(result.errorClass).toBe("credential");
		});

		it("throws ContextError for invalid context name", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.validateContextByName("bad name!")).rejects.toThrow(ContextError);
		});

		it("throws ContextError for missing context", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.validateContextByName("nonexistent")).rejects.toThrow(/not found/);
		});

		it("throws ContextError for incompatible schema version", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_INCOMPAT);
			const service = ContextService.init(xcshConfigDir);
			await expect(service.validateContextByName(TEST_CONTEXT_INCOMPAT.name)).rejects.toThrow(/schema version/);
		});

		it("does not mutate cached auth state when validating a non-active context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			globalThis.fetch = makeMockResponse(200);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.validateToken();
			const before = service.getStatus();

			globalThis.fetch = makeMockResponse(401);
			await service.validateContextByName(TEST_CONTEXT_2.name);

			const after = service.getStatus();
			expect(after.authStatus).toBe(before.authStatus);
			expect(after.authCheckedAt).toBe(before.authCheckedAt);
			expect(after.authLatencyMs).toBe(before.authLatencyMs);
		});
	});

	describe("getActiveEnvKeys", () => {
		it("returns [] when no active context", () => {
			const service = ContextService.init(xcshConfigDir);
			expect(service.getActiveEnvKeys()).toEqual([]);
		});

		it("returns sorted keys from active context's env record", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_ENV);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT_ENV.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			const keys = service.getActiveEnvKeys();
			expect(keys).toEqual(Object.keys(TEST_CONTEXT_WITH_ENV.env).sort());
		});
	});

	describe("contexts cache (listContextNamesCached + getContextHint)", () => {
		it("listContextNamesCached returns [] between init() and loadActive()", () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const service = ContextService.init(xcshConfigDir);
			expect(service.listContextNamesCached()).toEqual([]);
		});

		it("populates from loadActive() and returns sorted names", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT); // "production"
			writeContext(xcshContextsDir, TEST_CONTEXT_2); // "staging"
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			expect(service.listContextNamesCached()).toEqual(["production", "staging"]);
		});

		it("refreshes cache when listContexts() is called again after a direct filesystem change", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			expect(service.listContextNamesCached()).toEqual(["production"]);
			writeContext(xcshContextsDir, TEST_CONTEXT_2); // simulate sibling-process add
			await service.listContexts(); // cache updates via this call
			expect(service.listContextNamesCached()).toEqual(["production", "staging"]);
		});

		it("createContext updates cache in place", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await service.createContext(TEST_CONTEXT_2);
			expect(service.listContextNamesCached()).toEqual(["production", "staging"]);
		});

		it("deleteContext removes from cache", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await service.deleteContext("staging");
			expect(service.listContextNamesCached()).toEqual(["production"]);
		});

		it("getContextHint returns null for unknown name", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			expect(service.getContextHint("nope")).toBeNull();
		});

		it("getContextHint returns apiUrl and incompatible=false for compatible context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			const hint = service.getContextHint("production");
			expect(hint).not.toBeNull();
			expect(hint!.apiUrl).toBe(TEST_CONTEXT.apiUrl);
			expect(hint!.incompatible).toBe(false);
			expect("schemaVersion" in hint!).toBe(false);
		});

		it("getContextHint returns incompatible=true and schemaVersion for schema v2 context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_INCOMPAT);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			const hint = service.getContextHint(TEST_CONTEXT_INCOMPAT.name);
			expect(hint).not.toBeNull();
			expect(hint!.incompatible).toBe(true);
			expect(hint!.schemaVersion).toBe(2);
		});

		it("listContexts skips files whose basename fails the context-name regex", async () => {
			// A well-formed context that will be listed.
			writeContext(xcshContextsDir, TEST_CONTEXT);
			// A stray file (copied/synced manually) whose basename has a space — can
			// never be activated because #validateContextName would reject it, so
			// /context list and /context activate <tab> must also hide it.
			fs.mkdirSync(xcshContextsDir, { recursive: true });
			fs.writeFileSync(
				path.join(xcshContextsDir, "bad name.json"),
				JSON.stringify({
					apiUrl: TEST_CONTEXT.apiUrl,
					apiToken: TEST_CONTEXT.apiToken,
					defaultNamespace: "default",
				}),
				{ mode: 0o600 },
			);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const names = service.listContextNamesCached();
			expect(names).toContain(TEST_CONTEXT.name);
			expect(names).not.toContain("bad name");
			const listed = await service.listContexts();
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

		async function setupActiveContext(fetchMock?: typeof globalThis.fetch): Promise<ContextService> {
			if (fetchMock) globalThis.fetch = fetchMock;
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			return service;
		}

		it("getCachedNamespaces returns [] before activation", () => {
			const service = ContextService.init(xcshConfigDir);
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("loadActive populates namespace cache sorted by name", async () => {
			const service = await setupActiveContext(
				makeMockJsonResponse(200, {
					items: [{ name: "production" }, { name: "default" }, { name: "shared" }],
				}),
			);
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["default", "production", "shared"]);
		});

		it("validateToken no longer populates namespace cache", async () => {
			const service = await setupActiveContext(makeMockJsonResponse(200, { items: [{ name: "ns1" }] }));
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);

			let fetchCallCount = 0;
			globalThis.fetch = (async () => {
				fetchCallCount++;
				return new Response(JSON.stringify({ items: [{ name: "ns-from-validate" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);
			expect(fetchCallCount).toBe(1);
		});

		it("env override (XCSH_API_TOKEN) suppresses namespace population on activation", async () => {
			try {
				process.env.XCSH_API_TOKEN = "different-account-token";
				const service = await setupActiveContext(
					makeMockJsonResponse(200, { items: [{ name: "env-token-account-ns" }] }),
				);
				await waitForCachePopulate();
				expect(service.getCachedNamespaces()).toEqual([]);
			} finally {
				delete process.env.XCSH_API_TOKEN;
			}
		});

		it("stale in-flight namespace response is discarded when activate() intervenes", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			let releaseNamespaces: (value: { name: string }[]) => void = () => {};
			const namespacesPromise = new Promise<{ name: string }[]>(resolve => {
				releaseNamespaces = resolve;
			});

			let callCount = 0;
			globalThis.fetch = (async () => {
				callCount++;
				if (callCount === 1) {
					const body = await namespacesPromise;
					return new Response(JSON.stringify({ items: body }), { status: 200 });
				}
				return new Response(JSON.stringify({ items: [{ name: "ns-from-second-context" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.activate(TEST_CONTEXT_2.name);
			await waitForCachePopulate();

			releaseNamespaces([{ name: "stale-from-prior-context" }]);
			await waitForCachePopulate();

			const cached = service.getCachedNamespaces();
			expect(cached).not.toContain("stale-from-prior-context");
		});

		it("env-backed session (no active context) has empty namespace cache", async () => {
			globalThis.fetch = makeMockJsonResponse(200, { items: [{ name: "ns1" }] });
			const service = ContextService.init(xcshConfigDir);
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("namespace cache persists across validateToken calls", async () => {
			const service = await setupActiveContext(makeMockJsonResponse(200, { items: [{ name: "ns1" }] }));
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);
			globalThis.fetch = makeMockTextResponse(502);
			await service.validateToken();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1"]);
		});

		it("malformed namespace response (items not an array) leaves cache empty", async () => {
			const service = await setupActiveContext(makeMockJsonResponse(200, { items: "not-an-array" }));
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("client.listNamespaces auth failure leaves cache empty (logged, not thrown)", async () => {
			const service = await setupActiveContext(makeMockJsonResponse(401, {}));
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual([]);
		});

		it("activate repopulates namespace cache with new context data", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			let callCount = 0;
			globalThis.fetch = (async () => {
				callCount++;
				if (callCount === 1) {
					return new Response(JSON.stringify({ items: [{ name: "ns1" }, { name: "ns2" }] }), { status: 200 });
				}
				return new Response(JSON.stringify({ items: [{ name: "staging-ns" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["ns1", "ns2"]);

			await service.activate(TEST_CONTEXT_2.name);
			await waitForCachePopulate();
			expect(service.getCachedNamespaces()).toEqual(["staging-ns"]);
		});
	});

	describe("ContextService.validateToken auth freshness cache", () => {
		let savedFetch: typeof globalThis.fetch;

		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});

		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function makeMockResponse(status: number): typeof globalThis.fetch {
			const headers = status === 200 ? { "content-type": "application/json" } : {};
			const fn = () => Promise.resolve(new Response(status === 200 ? "{}" : "err", { status, headers }));
			return fn as unknown as typeof globalThis.fetch;
		}

		function makeNetworkError(): typeof globalThis.fetch {
			const fn = () => Promise.reject(new Error("network failure"));
			return fn as unknown as typeof globalThis.fetch;
		}

		// Helper: set up a service with TEST_CONTEXT as the active context, ready for
		// active-mode validateToken() calls that populate cache. Ad-hoc mode (validateToken with
		// explicit apiUrl/apiToken args) deliberately does NOT touch cache — see the dedicated
		// ad-hoc test below.
		async function activeContextService(): Promise<ContextService> {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			return service;
		}

		it("populates authLatencyMs and authCheckedAt on a successful validation", async () => {
			globalThis.fetch = makeMockResponse(200);
			const service = await activeContextService();

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
			const service = await activeContextService();

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
			const service = await activeContextService();

			await service.validateToken();

			const status = service.getStatus();
			expect(typeof status.authCheckedAt).toBe("number");
			expect(Number.isInteger(status.authCheckedAt)).toBe(true);
		});

		it("invalidates the auth-freshness cache on context switch", async () => {
			// Arrange: two contexts, activate the first, run a successful validateToken to populate the cache.
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = makeMockResponse(200);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await service.validateToken();

			const before = service.getStatus();
			expect(before.authStatus).toBe("connected");
			expect(typeof before.authLatencyMs).toBe("number");
			expect(typeof before.authCheckedAt).toBe("number");

			// Act: switch to the second context. Do not re-validate.
			await service.activate(TEST_CONTEXT_2.name);

			// Assert: cache fields cleared; auth status resets to unknown until the next validateToken.
			const after = service.getStatus();
			expect(after.authStatus).toBe("unknown");
			expect(after.authLatencyMs).toBeUndefined();
			expect(after.authCheckedAt).toBeUndefined();
		});

		it("does not overwrite the active context's cached auth state when called in ad-hoc mode", async () => {
			// Regression test for cross-context cache clobber: /context show <other> calls
			// validateToken with explicit apiUrl/apiToken to check a context that is NOT active.
			// The cached fields (#lastAuthLatencyMs, #lastAuthCheckedAt, #authStatus) are reported
			// by getStatus() as the ACTIVE context's auth state, so ad-hoc validation must not
			// clobber them.
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = makeMockResponse(200);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await service.validateToken(); // populate cache for active context
			const before = service.getStatus();
			expect(before.authStatus).toBe("connected");
			expect(typeof before.authLatencyMs).toBe("number");
			const cachedLatency = before.authLatencyMs;
			const cachedCheckedAt = before.authCheckedAt;

			// Ad-hoc validate a DIFFERENT context by passing explicit apiUrl/apiToken.
			// The result path is 401 — which would set authStatus to "auth_error" if not guarded.
			globalThis.fetch = makeMockResponse(401);
			const adHocResult = await service.validateToken({
				apiUrl: TEST_CONTEXT_2.apiUrl,
				apiToken: TEST_CONTEXT_2.apiToken,
			});
			expect(adHocResult.status).toBe("auth_error");

			// Active context's cached state must be unchanged.
			const after = service.getStatus();
			expect(after.authStatus).toBe("connected");
			expect(after.authLatencyMs).toBe(cachedLatency);
			expect(after.authCheckedAt).toBe(cachedCheckedAt);
		});

		it("updates the cache when called with explicit creds that match the active context", async () => {
			// Regression test: /context show (with no name, or with the active context's name)
			// passes explicit apiUrl/apiToken to validateToken via handleShow — but those creds
			// still match the active/effective ones. A naive ad-hoc check that triggers on
			// `options.apiUrl !== undefined` would incorrectly skip the cache refresh, leaving
			// getStatus() consumers stuck on stale auth state after the user explicitly asked
			// for a fresh validation. The refined check compares supplied creds against the
			// active/effective ones and only treats a mismatch as ad-hoc.
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = makeMockResponse(200);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const before = Date.now();
			// Call validateToken with explicit creds that match the active context — this is
			// exactly what handleShow(ctx, service) does for a `/context show` on the active context.
			await service.validateToken({
				apiUrl: TEST_CONTEXT.apiUrl,
				apiToken: TEST_CONTEXT.apiToken,
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

	describe("renameContext", () => {
		it("renames an inactive context: file moves, cache updates", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.renameContext(TEST_CONTEXT_2.name, "staging-renamed");

			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT_2.name}.json`))).toBe(false);
			expect(fs.existsSync(path.join(xcshContextsDir, "staging-renamed.json"))).toBe(true);
			const names = service.listContextNamesCached();
			expect(names).toContain("staging-renamed");
			expect(names).not.toContain(TEST_CONTEXT_2.name);
			expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT.name);
		});

		it("renames the active context: file moves, pointer updates, onContextChange fires", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const changes: XCSHContext[] = [];
			const listener = (p: XCSHContext) => changes.push(p);
			ContextService.onContextChange(listener);
			try {
				await service.renameContext(TEST_CONTEXT.name, "prod-renamed");
			} finally {
				ContextService.offContextChange(listener);
			}

			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(false);
			expect(fs.existsSync(path.join(xcshContextsDir, "prod-renamed.json"))).toBe(true);
			expect(fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8").trim()).toBe("prod-renamed");
			expect(service.getStatus().activeContextName).toBe("prod-renamed");
			expect(changes.length).toBe(1);
			expect(changes[0].name).toBe("prod-renamed");
			// Regression guard: listener payload must carry every field of the
			// renamed context, not just the new name. A bug where the spread
			// dropped fields would still pass the name check above.
			expect(changes[0].apiUrl).toBe(TEST_CONTEXT.apiUrl);
			expect(changes[0].apiToken).toBe(TEST_CONTEXT.apiToken);
			expect(changes[0].defaultNamespace).toBe(TEST_CONTEXT.defaultNamespace);
		});

		it("throws ContextError for invalid new name", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await expect(service.renameContext(TEST_CONTEXT.name, "bad name!")).rejects.toThrow(ContextError);
		});

		it("throws ContextError when target name already exists", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			await expect(service.renameContext(TEST_CONTEXT.name, TEST_CONTEXT_2.name)).rejects.toThrow(/already exists/);
		});

		it("throws ContextError when source context does not exist", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.renameContext("nonexistent", "whatever")).rejects.toThrow(/not found/);
		});

		it("updates active_context pointer when renaming under XCSH_API_URL override", async () => {
			// Regression: with XCSH_API_URL set, loadActive() returns null and
			// #activeContext stays null even when active_context on disk names
			// a real context. Renaming that context must still update the
			// on-disk active_context pointer so the next non-env session can
			// restore the user's previous active selection.
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			// Simulate env-backed session
			process.env.XCSH_API_URL = "https://override.console.ves.volterra.io";
			try {
				const service = ContextService.init(xcshConfigDir);
				await service.loadActive();
				// In-memory active is null under env override
				expect(service.getStatus().activeContextName).toBe(null);

				await service.renameContext(TEST_CONTEXT.name, "prod-renamed");

				// File moved
				expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(false);
				expect(fs.existsSync(path.join(xcshContextsDir, "prod-renamed.json"))).toBe(true);
				// Critically: on-disk pointer updated too
				expect(fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8").trim()).toBe("prod-renamed");
			} finally {
				delete process.env.XCSH_API_URL;
			}
		});

		it("throws ContextError on identity rename of a missing context", async () => {
			// Regression: renaming a context to itself must not short-circuit
			// before the existence check, or a typo would silently succeed.
			const service = ContextService.init(xcshConfigDir);
			await expect(service.renameContext("ghost", "ghost")).rejects.toThrow(/not found/);
		});

		it("rejects renaming TO a reserved subcommand name", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await expect(service.renameContext(TEST_CONTEXT.name, "status")).rejects.toThrow(
				/conflicts with a \/context subcommand/,
			);
			// Original file must still exist — rename was rejected before any I/O
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(true);
		});

		it("allows renaming FROM a reserved name to a non-reserved name", async () => {
			// Bypass createContext to simulate pre-guard data on disk
			writeContext(xcshContextsDir, { ...TEST_CONTEXT, name: "list" });
			writeActiveContext(xcshConfigDir, "list");
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.renameContext("list", "my-list");

			expect(fs.existsSync(path.join(xcshContextsDir, "list.json"))).toBe(false);
			expect(fs.existsSync(path.join(xcshContextsDir, "my-list.json"))).toBe(true);
		});

		it("rolls back when pointer write fails (EISDIR trick)", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			// Pre-create active_context.tmp as a DIRECTORY — #atomicWrite's
			// writeFileSync(tmpPath, content) will throw EISDIR before the rename
			// step, deterministically triggering the rollback path regardless of
			// the executing UID.
			const tmpPath = path.join(xcshConfigDir, "active_context.tmp");
			fs.mkdirSync(tmpPath, { recursive: true });

			try {
				const service = ContextService.init(xcshConfigDir);
				await service.loadActive();
				await expect(service.renameContext(TEST_CONTEXT.name, "prod-renamed")).rejects.toThrow(
					/Failed to update active context pointer/,
				);
				expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(true);
				expect(fs.existsSync(path.join(xcshContextsDir, "prod-renamed.json"))).toBe(false);
				expect(fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8").trim()).toBe(TEST_CONTEXT.name);
			} finally {
				fs.rmSync(tmpPath, { recursive: true, force: true });
			}
		});
	});

	describe("exportContexts", () => {
		it("exports a single named context, masked by default", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();

			const bundle = await service.exportContexts({ names: [TEST_CONTEXT.name], includeToken: false });
			expect(bundle.version).toBe(1);
			expect(bundle.tokensMasked).toBe(true);
			expect(bundle.contexts.length).toBe(1);
			expect(bundle.contexts[0].name).toBe(TEST_CONTEXT.name);
			expect(bundle.contexts[0].apiToken.startsWith("...")).toBe(true);
			// ISO 8601 UTC format with `Z` suffix — pins the contract so a future
			// refactor to e.g. toLocaleDateString() would fail this test.
			expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
		});

		it("exports all contexts when names is omitted", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();

			const bundle = await service.exportContexts({ includeToken: false });
			expect(bundle.contexts.length).toBe(2);
			expect(bundle.contexts.map(p => p.name).sort()).toEqual(["production", "staging"]);
		});

		it("preserves raw token when includeToken: true and sets tokensMasked: false", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();

			const bundle = await service.exportContexts({ includeToken: true });
			expect(bundle.tokensMasked).toBe(false);
			expect(bundle.contexts[0].apiToken).toBe(TEST_CONTEXT.apiToken);
		});

		it("masks sensitiveKeys env values when includeToken: false", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_ENV);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			// setEnvVars auto-detects XCSH_CONSOLE_PASSWORD as sensitive
			await service.setEnvVars(TEST_CONTEXT_ENV.name, { XCSH_CONSOLE_PASSWORD: "secret123" });

			const bundle = await service.exportContexts({
				names: [TEST_CONTEXT_ENV.name],
				includeToken: false,
			});
			const password = bundle.contexts[0].env?.XCSH_CONSOLE_PASSWORD;
			expect(password).toBeTruthy();
			expect(password?.startsWith("...")).toBe(true);
		});

		it("preserves sensitiveKeys env values when includeToken: true", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT_ENV);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await service.setEnvVars(TEST_CONTEXT_ENV.name, { XCSH_CONSOLE_PASSWORD: "secret123" });

			const bundle = await service.exportContexts({
				names: [TEST_CONTEXT_ENV.name],
				includeToken: true,
			});
			expect(bundle.contexts[0].env?.XCSH_CONSOLE_PASSWORD).toBe("secret123");
		});

		it("masks secret-looking env keys even when sensitiveKeys is absent", async () => {
			// Regression: `/context show` masks env values whose key matches
			// SECRET_ENV_PATTERNS (e.g. XCSH_CONSOLE_PASSWORD, SOMETHING_TOKEN).
			// Export must match that contract — a context edited directly on
			// disk with a secret-looking key but no sensitiveKeys entry must
			// still have its values masked on export.
			const contextWithBareSecret: XCSHContext = {
				name: "raw-secret",
				apiUrl: "https://raw.console.ves.volterra.io",
				apiToken: "raw-token-plaintext-xxxx",
				defaultNamespace: "default",
				env: {
					XCSH_CONSOLE_PASSWORD: "leaked-password",
					XCSH_EXTRA_TOKEN: "leaked-token",
					XCSH_EMAIL: "user@example.com",
				},
				// sensitiveKeys intentionally undefined
			};
			writeContext(xcshContextsDir, contextWithBareSecret);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();

			const bundle = await service.exportContexts({
				names: [contextWithBareSecret.name],
				includeToken: false,
			});
			const env = bundle.contexts[0].env ?? {};
			// Both secret-shaped keys must be masked
			expect(env.XCSH_CONSOLE_PASSWORD?.startsWith("...")).toBe(true);
			expect(env.XCSH_EXTRA_TOKEN?.startsWith("...")).toBe(true);
			// Non-secret key passes through
			expect(env.XCSH_EMAIL).toBe("user@example.com");
			// Raw values never appear
			expect(env.XCSH_CONSOLE_PASSWORD).not.toBe("leaked-password");
			expect(env.XCSH_EXTRA_TOKEN).not.toBe("leaked-token");
		});

		it("throws ContextError when a named context does not exist", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			await expect(service.exportContexts({ names: ["nonexistent"], includeToken: false })).rejects.toThrow(
				/not found/,
			);
		});

		// Cache-safety regression test (CRITICAL): structuredClone before mask is
		// the guard. Without it, maskToken() mutates the cached context that is
		// also referenced by #activeContext, breaking subsequent activate/validate.
		it("does not corrupt cached context tokens after a masked export", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.exportContexts({ includeToken: false });

			// Re-activate — the raw token must still be intact
			const reactivated = await service.activate(TEST_CONTEXT.name);
			expect(reactivated.apiToken).toBe(TEST_CONTEXT.apiToken);
			expect(reactivated.apiToken).not.toContain("...");
		});
	});

	describe("previousContextName", () => {
		it("is null after fresh init", async () => {
			const service = ContextService.init(xcshConfigDir);
			expect(service.previousContextName).toBeNull();
		});

		it("tracks the previous context on activate", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.activate(TEST_CONTEXT_2.name);

			expect(service.previousContextName).toBe(TEST_CONTEXT.name);
		});

		it("does not change previousContextName when re-activating the same context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.activate(TEST_CONTEXT_2.name);
			expect(service.previousContextName).toBe(TEST_CONTEXT.name);

			// Re-activate the same context — previous should NOT change
			await service.activate(TEST_CONTEXT_2.name);
			expect(service.previousContextName).toBe(TEST_CONTEXT.name);
		});

		it("activatePrevious switches to the previous context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.activate(TEST_CONTEXT_2.name);
			const result = await service.activatePrevious();

			expect(result.name).toBe(TEST_CONTEXT.name);
			expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT.name);
		});

		it("activatePrevious twice returns to the original context (ping-pong)", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.activate(TEST_CONTEXT_2.name);
			await service.activatePrevious();
			await service.activatePrevious();

			expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT_2.name);
			expect(service.previousContextName).toBe(TEST_CONTEXT.name);
		});

		it("activatePrevious throws when no previous exists", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.activatePrevious()).rejects.toThrow(/No previous context/);
		});

		it("deleteContext clears previousContextName when deleting the previous context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			await service.activate(TEST_CONTEXT_2.name);
			expect(service.previousContextName).toBe(TEST_CONTEXT.name);

			await service.deleteContext(TEST_CONTEXT.name);
			expect(service.previousContextName).toBeNull();
		});

		it("renameContext updates previousContextName when renaming the previous context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT_2.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			// Switch from staging to production — previous becomes "staging"
			await service.activate(TEST_CONTEXT.name);
			expect(service.previousContextName).toBe(TEST_CONTEXT_2.name);

			// Rename staging to staging-v2 — previous should update
			await service.renameContext(TEST_CONTEXT_2.name, "staging-v2");
			expect(service.previousContextName).toBe("staging-v2");
		});
	});

	describe("importContexts", () => {
		function makeBundle(contexts: XCSHContext[], tokensMasked = false): unknown {
			return {
				version: 1,
				exportedAt: new Date().toISOString(),
				tokensMasked,
				contexts,
			};
		}

		it("imports a fresh bundle into an empty state", async () => {
			const service = ContextService.init(xcshConfigDir);
			const bundle = makeBundle([{ ...TEST_CONTEXT }, { ...TEST_CONTEXT_2 }]);

			const result = await service.importContexts(bundle, { overwrite: false });
			expect(result.imported.sort()).toEqual(["production", "staging"]);
			expect(result.overwritten).toEqual([]);
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(true);
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT_2.name}.json`))).toBe(true);
		});

		it("throws with all conflict names when overwrite: false", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			const bundle = makeBundle([{ ...TEST_CONTEXT }, { ...TEST_CONTEXT_2 }]);

			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(
				/production.*staging|staging.*production/,
			);
		});

		it("overwrites conflicting contexts when overwrite: true", async () => {
			writeContext(xcshContextsDir, { ...TEST_CONTEXT, defaultNamespace: "original-ns" });
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			const bundle = makeBundle([{ ...TEST_CONTEXT, defaultNamespace: "imported-ns" }]);

			const result = await service.importContexts(bundle, { overwrite: true });
			expect(result.imported).toEqual([TEST_CONTEXT.name]);
			expect(result.overwritten).toEqual([TEST_CONTEXT.name]);
			const onDisk = JSON.parse(fs.readFileSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`), "utf-8"));
			expect(onDisk.defaultNamespace).toBe("imported-ns");
		});

		it("rejects bundles with tokensMasked: true", async () => {
			const service = ContextService.init(xcshConfigDir);
			const bundle = makeBundle([{ ...TEST_CONTEXT, apiToken: "...g7h8" }], true);
			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(/masked tokens/i);
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(false);
		});

		it("rejects envelope with missing required fields", async () => {
			const service = ContextService.init(xcshConfigDir);
			await expect(service.importContexts({ profiles: [TEST_CONTEXT] }, { overwrite: false })).rejects.toThrow(
				/missing required fields/i,
			);
			await expect(service.importContexts({}, { overwrite: false })).rejects.toThrow(/missing required fields/i);
			await expect(service.importContexts(null, { overwrite: false })).rejects.toThrow(/missing required fields/i);
		});

		it("rejects envelope with wrong version", async () => {
			const service = ContextService.init(xcshConfigDir);
			const bundle = { version: 999, exportedAt: "", tokensMasked: false, contexts: [TEST_CONTEXT] };
			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(/version/);
		});

		it("rejects per-context field-shape failures without writing", async () => {
			const service = ContextService.init(xcshConfigDir);
			const bundle = makeBundle([
				{ ...TEST_CONTEXT },
				// Invalid: apiToken empty string
				{ name: "bad", apiUrl: "https://x.com", apiToken: "", defaultNamespace: "default" } as XCSHContext,
			]);
			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(/bad/);
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(false);
		});

		it("uses fresh listContexts for conflict detection (not stale cache)", async () => {
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts(); // cache is empty

			// Simulate an external actor creating a context AFTER cache was populated
			writeContext(xcshContextsDir, TEST_CONTEXT);

			const bundle = makeBundle([{ ...TEST_CONTEXT }]);
			// importContexts must re-read the directory and find the conflict
			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(/conflict/i);
		});

		it("refreshes active context state when an overwrite touches the active context", async () => {
			// Regression: overwriting the active context must re-apply its new
			// credentials to #activeContext, Settings.bash.environment, and
			// cached auth metadata. Otherwise the session keeps using the old
			// token until restart or manual re-activation.
			writeContext(xcshContextsDir, { ...TEST_CONTEXT, defaultNamespace: "old-ns" });
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bundle = makeBundle([
				{
					...TEST_CONTEXT,
					apiUrl: "https://newtenant.console.ves.volterra.io",
					apiToken: "new-token-value",
					defaultNamespace: "new-ns",
				},
			]);
			const result = await service.importContexts(bundle, { overwrite: true });
			expect(result.overwritten).toEqual([TEST_CONTEXT.name]);

			// The active context's in-memory snapshot is refreshed — next
			// status call reflects the new URL and namespace.
			const status = service.getStatus();
			expect(status.activeContextUrl).toBe("https://newtenant.console.ves.volterra.io");
			expect(status.activeContextNamespace).toBe("new-ns");

			// Settings.bash.environment is refreshed too (the env-vars the
			// subprocess would inherit).
			const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
			expect(bashEnv.XCSH_API_URL).toBe("https://newtenant.console.ves.volterra.io");
			expect(bashEnv.XCSH_API_TOKEN).toBe("new-token-value");
			expect(bashEnv.XCSH_NAMESPACE).toBe("new-ns");
		});

		it("does not re-activate when the overwrite does not touch the active context", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, { ...TEST_CONTEXT_2, defaultNamespace: "staging-original" });
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const bundle = makeBundle([{ ...TEST_CONTEXT_2, defaultNamespace: "staging-replaced" }]);
			await service.importContexts(bundle, { overwrite: true });

			// Active context unchanged
			expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT.name);
			expect(service.getStatus().activeContextUrl).toBe(TEST_CONTEXT.apiUrl);
		});

		it("rejects a bundle containing a context with incompatible schema version", async () => {
			// Regression: a bundle produced by a newer xcsh (per-context version
			// > CURRENT_SCHEMA_VERSION) used to pass shape checks and reach the
			// write loop. The files would land on disk, then activate() would
			// reject them as "schema version" incompatible — leaving the user
			// with an unusable on-disk context and potentially a stale
			// active_context pointer. Reject before any write.
			const service = ContextService.init(xcshConfigDir);
			const futureContext: XCSHContext = {
				...TEST_CONTEXT,
				version: 999,
			};
			const bundle = makeBundle([futureContext]);
			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(
				/incompatible schema version|schema version/i,
			);
			// No write happened — contexts dir is empty or non-existent.
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(false);
		});

		it("rejects a bundle with duplicate context names inside it", async () => {
			// Regression: two bundle entries with the same name would silently
			// clobber the first in the write loop and emit misleading duplicated
			// names in `imported[]`. Reject upfront before any write.
			const service = ContextService.init(xcshConfigDir);
			const bundle = makeBundle([
				{ ...TEST_CONTEXT, defaultNamespace: "first" },
				{ ...TEST_CONTEXT, defaultNamespace: "second" },
			]);
			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(/duplicate context name/i);
			// Nothing written: the original context file from a prior test state
			// is absent (no writeContext call in this test), so the write loop
			// never ran.
			expect(fs.existsSync(path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(false);
		});

		it("writes imported context files with 0o600 permissions", async () => {
			// Regression: context JSON carries API tokens. #atomicWrite was
			// creating tmp files under process umask (typically 0644), and
			// fs.renameSync inherits source permissions — so imported files
			// ended up world-readable even though createContext forces 0o600.
			// Check the mode of the resulting file matches the credential-file
			// contract.
			const service = ContextService.init(xcshConfigDir);
			const bundle = makeBundle([{ ...TEST_CONTEXT }]);
			await service.importContexts(bundle, { overwrite: false });

			const onDiskPath = path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`);
			const stat = fs.statSync(onDiskPath);
			// Mask to permission bits; assert owner-only rw, no group/other access.
			expect(stat.mode & 0o777).toBe(0o600);
		});

		it("preserves 0o600 permissions when overwriting an imported context", async () => {
			// Same invariant must hold on the overwrite path (the tmp file is
			// created fresh, so this exercises the same code path — but it's
			// the credential-exposure case Codex called out most directly).
			writeContext(xcshContextsDir, TEST_CONTEXT); // createContext-equivalent: 0o600
			const service = ContextService.init(xcshConfigDir);
			await service.listContexts();
			const bundle = makeBundle([{ ...TEST_CONTEXT, defaultNamespace: "replaced" }]);
			await service.importContexts(bundle, { overwrite: true });

			const onDiskPath = path.join(xcshContextsDir, `${TEST_CONTEXT.name}.json`);
			const stat = fs.statSync(onDiskPath);
			expect(stat.mode & 0o777).toBe(0o600);
		});

		it("returns an empty result for a bundle with no contexts", async () => {
			const service = ContextService.init(xcshConfigDir);
			const bundle = makeBundle([]);
			const result = await service.importContexts(bundle, { overwrite: false });
			expect(result.imported).toEqual([]);
			expect(result.overwritten).toEqual([]);
			expect(result.skipped).toEqual([]);
		});

		it("rejects a bundle containing a reserved subcommand name", async () => {
			const service = ContextService.init(xcshConfigDir);
			const reserved: XCSHContext = {
				name: "delete",
				apiUrl: "https://t.console.ves.volterra.io",
				apiToken: "tok",
				defaultNamespace: "default",
			};
			const bundle = makeBundle([reserved]);

			await expect(service.importContexts(bundle, { overwrite: false })).rejects.toThrow(/reserved subcommand name/);
			// No file should have been written
			expect(fs.existsSync(path.join(xcshContextsDir, "delete.json"))).toBe(false);
		});

		it("rejects reserved names alongside other invalid entries in a single error", async () => {
			const service = ContextService.init(xcshConfigDir);
			const bundle = {
				version: 1,
				exportedAt: new Date().toISOString(),
				tokensMasked: false,
				contexts: [
					{ name: "import", apiUrl: "https://t.console.ves.volterra.io", apiToken: "tok", defaultNamespace: "d" },
					{
						name: "bad name!",
						apiUrl: "https://t.console.ves.volterra.io",
						apiToken: "tok",
						defaultNamespace: "d",
					},
				],
			};

			const err = await service.importContexts(bundle, { overwrite: false }).catch((e: Error) => e);
			expect(err).toBeInstanceOf(ContextError);
			expect((err as Error).message).toMatch(/2 invalid context/);
			expect((err as Error).message).toMatch(/import \(reserved subcommand name\)/);
			expect((err as Error).message).toMatch(/bad name! \(invalid name\)/);
		});
	});

	describe("background token re-validation", () => {
		let savedFetch: typeof globalThis.fetch;
		beforeEach(() => {
			savedFetch = globalThis.fetch;
		});
		afterEach(() => {
			globalThis.fetch = savedFetch;
		});

		function wait(ms: number): Promise<void> {
			return new Promise(resolve => setTimeout(resolve, ms));
		}

		it("startRevalidation calls validateToken periodically", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			service.stopRevalidation();

			const spy = vi.spyOn(service, "validateToken").mockResolvedValue({ status: "connected" });
			service.startRevalidation(50);
			await wait(250);
			service.stopRevalidation();
			expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
			spy.mockRestore();
		});

		it("stopRevalidation clears the timer", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			service.stopRevalidation();

			const spy = vi.spyOn(service, "validateToken").mockResolvedValue({ status: "connected" });
			service.startRevalidation(50);
			await wait(80);
			service.stopRevalidation();
			await wait(20);
			const countAtStop = spy.mock.calls.length;
			await wait(200);
			expect(spy.mock.calls.length).toBe(countAtStop);
			spy.mockRestore();
		});

		it("onAuthStatusChange fires on status transition", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({}), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const transitions: Array<{ prev: string; current: string }> = [];
			const listener = (prev: string, current: string) => {
				transitions.push({ prev, current });
			};
			ContextService.onAuthStatusChange(listener);

			service.stopRevalidation();
			service.startRevalidation(50);
			await wait(120);
			service.stopRevalidation();
			ContextService.offAuthStatusChange(listener);

			expect(transitions.length).toBeGreaterThanOrEqual(1);
			expect(transitions[0]).toEqual({ prev: "unknown", current: "auth_error" });
		});

		it("onAuthStatusChange does not fire when status is stable", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();

			const transitions: Array<{ prev: string; current: string }> = [];
			const listener = (prev: string, current: string) => {
				transitions.push({ prev, current });
			};
			ContextService.onAuthStatusChange(listener);

			service.stopRevalidation();
			service.startRevalidation(50);
			await wait(300);
			service.stopRevalidation();
			ContextService.offAuthStatusChange(listener);

			expect(transitions).toEqual([{ prev: "unknown", current: "connected" }]);
		});

		it("context switch restarts the timer", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeContext(xcshContextsDir, TEST_CONTEXT_2);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			service.stopRevalidation();

			const spy = vi.spyOn(service, "validateToken").mockResolvedValue({ status: "connected" });
			await service.activate(TEST_CONTEXT_2.name);
			service.stopRevalidation();

			spy.mockClear();
			service.startRevalidation(50);
			await wait(250);
			service.stopRevalidation();
			expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
			spy.mockRestore();
		});

		it("_resetForTest clears timer and listeners", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			service.stopRevalidation();

			const spy = vi.spyOn(service, "validateToken").mockResolvedValue({ status: "connected" });
			const listener = () => {};
			ContextService.onAuthStatusChange(listener);
			service.startRevalidation(50);

			ContextService._resetForTest();
			const countAtReset = spy.mock.calls.length;
			await wait(200);
			expect(spy.mock.calls.length).toBe(countAtReset);
			spy.mockRestore();
		});

		it("recursive setTimeout prevents overlap", async () => {
			writeContext(xcshContextsDir, TEST_CONTEXT);
			writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const service = ContextService.init(xcshConfigDir);
			await service.loadActive();
			service.stopRevalidation();

			let callCount = 0;
			let concurrent = 0;
			let maxConcurrent = 0;
			const spy = vi.spyOn(service, "validateToken").mockImplementation(async () => {
				concurrent++;
				maxConcurrent = Math.max(maxConcurrent, concurrent);
				callCount++;
				await Bun.sleep(50);
				concurrent--;
				return { status: "connected" };
			});

			service.startRevalidation(10);
			await wait(300);
			service.stopRevalidation();

			expect(maxConcurrent).toBe(1);
			expect(callCount).toBeLessThanOrEqual(5);
			spy.mockRestore();
		});
	});
});
