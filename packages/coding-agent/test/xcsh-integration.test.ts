import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { _resetShellSessionsForTest, executeBash } from "@f5-sales-demo/xcsh/exec/bash-executor";
import { ContextService } from "@f5-sales-demo/xcsh/services/xcsh-context";
import {
	TEST_XCSH_NAMESPACE as TEST_NAMESPACE,
	TEST_STAGING_NAMESPACE,
	TEST_STAGING_TOKEN,
	TEST_STAGING_URL,
	TEST_XCSH_TOKEN as TEST_TOKEN,
	TEST_XCSH_URL as TEST_URL,
} from "./xcsh-test-fixtures";

describe("XCSH authentication end-to-end integration", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) {
				savedEnv[key] = process.env[key];
				delete process.env[key];
			}
		}

		testDir = path.join(os.tmpdir(), "test-xcsh-e2e", Snowflake.next());
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
		_resetShellSessionsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) process.env[key] = value;
		}
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("context credentials are available in bash subprocess after loadActive", async () => {
		// Setup: create context and active_context
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		// Load context (simulates startup sequence)
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		// Execute bash command — credentials should be in environment
		const urlResult = await executeBash("echo $XCSH_API_URL", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(urlResult.output.trim()).toBe(TEST_URL);

		const tokenResult = await executeBash("echo $XCSH_API_TOKEN", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(tokenResult.output.trim()).toBe(TEST_TOKEN);

		const nsResult = await executeBash("echo $XCSH_NAMESPACE", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(nsResult.output.trim()).toBe(TEST_NAMESPACE);
	});

	it("context switch updates bash subprocess environment", async () => {
		// Setup: two contexts
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(
			path.join(xcshContextsDir, "staging.json"),
			JSON.stringify({
				name: "staging",
				apiUrl: TEST_STAGING_URL,
				apiToken: TEST_STAGING_TOKEN,
				defaultNamespace: TEST_STAGING_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		// Load initial context
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		// Verify production is active
		const result1 = await executeBash("echo $XCSH_API_URL", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(result1.output.trim()).toBe(TEST_URL);

		// Switch to staging
		await service.activate("staging");

		// Verify staging is now active in bash env
		const result2 = await executeBash("echo $XCSH_API_URL", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(result2.output.trim()).toBe(TEST_STAGING_URL);
	});

	it("environment variables take precedence over context", async () => {
		// Setup: context exists
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		// XCSH_API_URL alone is the signal to skip context loading (FR-102)
		process.env.XCSH_API_URL = "https://env-override.console.ves.volterra.io";

		const service = ContextService.init(xcshConfigDir);
		const result = await service.loadActive();

		// Context should NOT have been loaded
		expect(result).toBeNull();
		expect(service.getStatus().credentialSource).toBe("environment");

		// bash.environment should NOT contain context credentials
		const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
		expect(bashEnv.XCSH_API_URL).toBeUndefined();
	});

	it("gracefully handles missing config directory at startup", async () => {
		// No xcsh config directory exists
		const service = ContextService.init(xcshConfigDir);
		const result = await service.loadActive();

		expect(result).toBeNull();

		// Bash should still work normally
		const bashResult = await executeBash("echo works", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(bashResult.output.trim()).toBe("works");
	});

	it("auto-activates single context when no active_context file exists", async () => {
		// Setup: one context, no active_context
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		// No active_context file

		const service = ContextService.init(xcshConfigDir);
		const result = await service.loadActive();

		expect(result).not.toBeNull();
		expect(result?.name).toBe("production");

		// Should have created active_context file
		const activeContextContent = fs.readFileSync(path.join(xcshConfigDir, "active_context"), "utf-8");
		expect(activeContextContent).toBe("production");

		// Credentials should be in bash environment
		const bashResult = await executeBash("echo $XCSH_API_URL", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(bashResult.output.trim()).toBe(TEST_URL);
	});

	it("T-005: active_context references missing JSON — no credentials injected", async () => {
		fs.mkdirSync(xcshConfigDir, { recursive: true });
		// active_context points to a context JSON that doesn't exist
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "vanished");

		const service = ContextService.init(xcshConfigDir);
		const result = await service.loadActive();
		expect(result).toBeNull();
		expect(service.getStatus().credentialSource).toBe("none");

		// bash.environment should NOT contain any XCSH vars
		const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
		expect(bashEnv.XCSH_API_URL).toBeUndefined();
		expect(bashEnv.XCSH_API_TOKEN).toBeUndefined();

		// Normal bash commands still work
		const echoResult = await executeBash("echo works", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(echoResult.output.trim()).toBe("works");
	});

	it("T-014: active_context file is plain text with no trailing newline", async () => {
		// Setup: single context triggers auto-activation
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive(); // auto-activates

		// Read raw bytes — no newline allowed (VS Code extension compatibility)
		const raw = fs.readFileSync(path.join(xcshConfigDir, "active_context"));
		const text = raw.toString("utf-8");
		expect(text).toBe("production");
		expect(text).not.toContain("\n");
		expect(text).not.toContain("\r");
	});

	it("per-field env override: XCSH_API_TOKEN from env, URL from context in bash.environment", async () => {
		process.env.XCSH_API_TOKEN = "env-override-token";
		// XCSH_API_URL is NOT set — context loads

		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		// URL should be injected into bash.environment from context
		const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
		expect(bashEnv.XCSH_API_URL).toBe(TEST_URL);
		// Token should NOT be in bash.environment (it's in process.env)
		expect(bashEnv.XCSH_API_TOKEN).toBeUndefined();
		// Namespace should be injected from context
		expect(bashEnv.XCSH_NAMESPACE).toBe(TEST_NAMESPACE);

		// Verify URL is available in bash subprocess (from bash.environment)
		const urlResult = await executeBash("echo $XCSH_API_URL", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(urlResult.output.trim()).toBe(TEST_URL);
	});

	it("create then activate then verify credentials in bash subprocess", async () => {
		const service = ContextService.init(xcshConfigDir);
		await service.createContext({
			name: "created-prof",
			apiUrl: TEST_URL,
			apiToken: TEST_TOKEN,
			defaultNamespace: TEST_NAMESPACE,
		});

		await service.activate("created-prof");

		const result = await executeBash("echo $XCSH_API_URL", {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(result.output.trim()).toBe(TEST_URL);
	});

	it("special characters in env values do not break bash", async () => {
		const specialUrl = "https://test.console.ves.volterra.io/api?a=1&b=2";
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "special.json"),
			JSON.stringify({
				name: "special",
				apiUrl: specialUrl,
				apiToken: "tok-with=equals&amps",
				defaultNamespace: "ns with spaces",
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "special");

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const result = await executeBash('echo "$XCSH_API_URL"', {
			cwd: projectDir,
			timeout: 5000,
		});
		expect(result.output.trim()).toBe(specialUrl);
	});

	it("env map vars are available in bash subprocess", async () => {
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
				env: {
					XCSH_LB_NAME: "test-lb",
					XCSH_DOMAINNAME: "test.example.com",
					XCSH_EMAIL: "test@example.com",
				},
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const lbResult = await executeBash("echo $XCSH_LB_NAME", { cwd: projectDir, timeout: 5000 });
		expect(lbResult.output.trim()).toBe("test-lb");

		const domainResult = await executeBash("echo $XCSH_DOMAINNAME", { cwd: projectDir, timeout: 5000 });
		expect(domainResult.output.trim()).toBe("test.example.com");

		const emailResult = await executeBash("echo $XCSH_EMAIL", { cwd: projectDir, timeout: 5000 });
		expect(emailResult.output.trim()).toBe("test@example.com");
	});

	it("XCSH_TENANT is auto-derived and available in bash subprocess", async () => {
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const tenantResult = await executeBash("echo $XCSH_TENANT", { cwd: projectDir, timeout: 5000 });
		expect(tenantResult.output.trim()).toBe("test-tenant");
	});

	it("token masking never exposes full token", async () => {
		fs.mkdirSync(xcshContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(xcshContextsDir, "production.json"),
			JSON.stringify({
				name: "production",
				apiUrl: TEST_URL,
				apiToken: TEST_TOKEN,
				defaultNamespace: TEST_NAMESPACE,
			}),
			{ mode: 0o600 },
		);
		fs.writeFileSync(path.join(xcshConfigDir, "active_context"), "production");

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const masked = service.maskToken(TEST_TOKEN);
		expect(masked).toBe(`...${TEST_TOKEN.slice(-4)}`);
		expect(masked).not.toBe(TEST_TOKEN);
		expect(masked.length).toBeLessThan(TEST_TOKEN.length);
	});
});
