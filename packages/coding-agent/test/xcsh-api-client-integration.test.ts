import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { ContextService, type XCSHContext } from "@f5-sales-demo/xcsh/services/xcsh-context";

const INTEGRATION_TEST_CONTEXT: XCSHContext = {
	name: "production",
	apiUrl: "https://test-tenant.console.ves.volterra.io",
	apiToken: "FAKE-TOKEN-FOR-UNIT-TESTS",
	defaultNamespace: "default",
};

const INTEGRATION_TEST_CONTEXT_STAGING: XCSHContext = {
	name: "staging",
	apiUrl: "https://test-staging.console.ves.volterra.io",
	apiToken: "FAKE-STAGING-TOKEN-FOR-TESTS",
	defaultNamespace: "staging-ns",
};

function writeContext(contextsDir: string, context: XCSHContext): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name, { mode: 0o644 });
}

describe("ContextService API client integration", () => {
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
		savedEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
		delete process.env.XDG_CONFIG_HOME;

		testDir = path.join(os.tmpdir(), "test-xcsh-api-client-integration", Snowflake.next());
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

	it("creates API client on loadActive", async () => {
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, INTEGRATION_TEST_CONTEXT.name);

		const service = ContextService.init(xcshConfigDir);
		expect(service.getApiClient()).toBeNull();

		await service.loadActive();
		const client = service.getApiClient();
		expect(client).not.toBeNull();
	});

	it("creates API client on activate with updated credentials", async () => {
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT);
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT_STAGING);
		writeActiveContext(xcshConfigDir, INTEGRATION_TEST_CONTEXT.name);

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		await service.activate("staging");
		const client = service.getApiClient();
		expect(client).not.toBeNull();
	});

	it("uses env-override token when XCSH_API_TOKEN is set", async () => {
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, INTEGRATION_TEST_CONTEXT.name);

		process.env.XCSH_API_TOKEN = "env-override-token";

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		let capturedAuthHeader = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string> | undefined;
			capturedAuthHeader = headers?.Authorization ?? "";
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		}) as unknown as typeof globalThis.fetch;

		try {
			const client = service.getApiClient();
			expect(client).not.toBeNull();
			await client!.listNamespaces();
			expect(capturedAuthHeader).toBe("APIToken env-override-token");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("uses env-override token on activate", async () => {
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT);
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT_STAGING);
		writeActiveContext(xcshConfigDir, INTEGRATION_TEST_CONTEXT.name);

		process.env.XCSH_API_TOKEN = "env-override-token";

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();
		await service.activate("staging");

		let capturedAuthHeader = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string> | undefined;
			capturedAuthHeader = headers?.Authorization ?? "";
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		}) as unknown as typeof globalThis.fetch;

		try {
			const client = service.getApiClient();
			expect(client).not.toBeNull();
			await client!.listNamespaces();
			expect(capturedAuthHeader).toBe("APIToken env-override-token");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("_resetForTest clears the API client", async () => {
		writeContext(xcshContextsDir, INTEGRATION_TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, INTEGRATION_TEST_CONTEXT.name);

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();
		expect(service.getApiClient()).not.toBeNull();

		ContextService._resetForTest();
		const freshService = ContextService.init(xcshConfigDir);
		expect(freshService.getApiClient()).toBeNull();
	});
});
