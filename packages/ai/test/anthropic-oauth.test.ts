import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore } from "../src/auth-storage";
import { type AnthropicAuthEnvironment, buildAnthropicUrl, findAnthropicAuth } from "../src/utils/anthropic-auth";
import { AnthropicOAuthFlow, loginAnthropic, refreshAnthropicToken } from "../src/utils/oauth/anthropic";

const originalFetch = global.fetch;

async function withEnv(
	overrides: AnthropicAuthEnvironment,
	fn: (environment: AnthropicAuthEnvironment) => void | Promise<void>,
): Promise<void> {
	await fn(overrides);
}

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("anthropic oauth alignment", () => {
	it("generates hosted and loopback URLs with shared least-privilege PKCE and state", async () => {
		const flow = new AnthropicOAuthFlow({});
		const state = "state-123";
		const redirectUri = "http://127.0.0.1:54545/callback";

		const { url, openUrl } = await flow.generateAuthInfo(state, redirectUri);
		const authUrl = new URL(url);
		const automaticUrl = new URL(openUrl);

		expect(authUrl.origin + authUrl.pathname).toBe("https://claude.com/cai/oauth/authorize");
		expect(authUrl.searchParams.get("scope")).toBe("user:profile user:inference");
		expect(authUrl.searchParams.get("state")).toBe(state);
		expect(authUrl.searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
		expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
		expect(automaticUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
		expect(automaticUrl.searchParams.get("state")).toBe(state);
		expect(automaticUrl.searchParams.get("code_challenge")).toBe(authUrl.searchParams.get("code_challenge"));
	});

	it("uses platform.claude.com token URL, route redirect, timeout, and account metadata", async () => {
		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(typeof input === "string" ? input : input.toString()).toBe(
				"https://platform.claude.com/v1/oauth/token",
			);
			expect(init?.method).toBe("POST");
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return new Response(
				JSON.stringify({
					access_token: "access-token",
					refresh_token: "refresh-token",
					expires_in: 3600,
					account: { uuid: "123456789012", email_address: "dana@example.com" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const flow = new AnthropicOAuthFlow({});
		await flow.generateAuthInfo("state-123", "http://127.0.0.1:54545/callback");

		const result = await flow.exchangeToken("code-123", "state-123", "http://127.0.0.1:54545/callback");

		expect(result).toMatchObject({
			access: "access-token",
			refresh: "refresh-token",
			accountId: "123456789012",
			email: "dana@example.com",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("stores top-level Anthropic account metadata", async () => {
		global.fetch = (async () =>
			new Response(
				JSON.stringify({
					access_token: "access",
					refresh_token: "refresh",
					expires_in: 3600,
					account_uuid: "123456789012",
					email_address: "dana@example.com",
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;

		const flow = new AnthropicOAuthFlow({});
		await flow.generateAuthUrl("state", "http://127.0.0.1/callback");
		const credentials = await flow.exchangeToken("code", "state", "http://127.0.0.1/callback");
		expect(credentials.accountId).toBe("123456789012");
		expect(credentials.email).toBe("dana@example.com");
	});

	it("rejects mismatched fragment state before token exchange", async () => {
		const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
			expect(typeof input === "string" ? input : input.toString()).toBe(
				"https://platform.claude.com/v1/oauth/token",
			);
			return new Response(
				JSON.stringify({
					access_token: "access-token",
					refresh_token: "refresh-token",
					expires_in: 3600,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const flow = new AnthropicOAuthFlow({});
		await flow.generateAuthInfo("state-123", "http://127.0.0.1:54545/callback");
		await expect(
			flow.exchangeToken("code-123#state-override", "state-123", "http://127.0.0.1:54545/callback"),
		).rejects.toThrow("state mismatch");

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects manual codes without exact code#state data", async () => {
		const onAuth = vi.fn();
		await expect(
			loginAnthropic({ onAuth, onManualCodeInput: async () => "code-without-state" }, { timeoutMs: 100 }),
		).rejects.toThrow("code#state");
		expect(onAuth.mock.calls[0]?.[0]).toMatchObject({
			url: expect.stringContaining("platform.claude.com%2Foauth%2Fcode%2Fcallback"),
			openUrl: expect.stringContaining("localhost"),
		});
	});

	it("exchanges an automatic callback against its loopback redirect", async () => {
		let exchangedRedirect = "";
		global.fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body));
			exchangedRedirect = payload.redirect_uri;
			return new Response(
				JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;
		const result = await loginAnthropic({
			onAuth(info) {
				const automatic = new URL(info.openUrl!);
				const callback = new URL(automatic.searchParams.get("redirect_uri")!);
				callback.searchParams.set("code", "automatic-code");
				callback.searchParams.set("state", automatic.searchParams.get("state")!);
				void originalFetch(callback);
			},
		});
		expect(result.access).toBe("access-token");
		expect(exchangedRedirect).toMatch(/^http:\/\/localhost:\d+\/callback$/);
	});

	it("honors cancellation before waiting for authorization", async () => {
		const abort = new AbortController();
		abort.abort();
		await expect(loginAnthropic({ signal: abort.signal }, { timeoutMs: 100 })).rejects.toThrow("cancelled");
	});

	it("does not expose provider response bodies in exchange errors", async () => {
		global.fetch = vi.fn(
			async () => new Response("secret provider diagnostic", { status: 400 }),
		) as unknown as typeof fetch;
		const flow = new AnthropicOAuthFlow({});
		await flow.generateAuthInfo("state-123", "http://127.0.0.1:54545/callback");
		await expect(flow.exchangeToken("code-123", "state-123", "http://127.0.0.1:54545/callback")).rejects.toThrow(
			"HTTP 400",
		);
		await expect(flow.exchangeToken("code-123", "state-123", "http://127.0.0.1:54545/callback")).rejects.not.toThrow(
			"secret provider diagnostic",
		);
	});

	it("uses platform.claude.com token URL for refresh and retains an omitted refresh token", async () => {
		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(typeof input === "string" ? input : input.toString()).toBe(
				"https://platform.claude.com/v1/oauth/token",
			);
			expect(init?.method).toBe("POST");
			return new Response(
				JSON.stringify({
					access_token: "new-access-token",
					expires_in: 7200,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const result = await refreshAnthropicToken("refresh-123");

		expect(result.access).toBe("new-access-token");
		expect(result.refresh).toBe("refresh-123");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("anthropic auth resolution", () => {
	it("prefers explicit Foundry env key over stored OAuth and normalizes Foundry base URL", async () => {
		const tmpDir = path.join(os.tmpdir(), `pi-ai-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		fs.mkdirSync(tmpDir, { recursive: true });
		const dbPath = path.join(tmpDir, "agent.db");
		const store = await AuthCredentialStore.open(dbPath);
		try {
			store.replaceAuthCredentialsForProvider("anthropic", [
				{ type: "oauth", access: "sk-ant-oat-db", refresh: "refresh", expires: Date.now() + 20 * 60 * 1000 },
			]);
			await withEnv(
				{
					CLAUDE_CODE_USE_FOUNDRY: "true",
					ANTHROPIC_FOUNDRY_API_KEY: "foundry-explicit-key",
					FOUNDRY_BASE_URL: "https://foundry.example.com/anthropic/",
					ANTHROPIC_API_KEY: undefined,
					ANTHROPIC_OAUTH_TOKEN: undefined,
				},
				async environment => {
					const auth = await findAnthropicAuth({ store, environment });
					expect(auth).not.toBeNull();
					expect(auth?.apiKey).toBe("foundry-explicit-key");
					expect(auth?.isOAuth).toBe(false);
					expect(auth?.baseUrl).toBe("https://foundry.example.com/anthropic");
					expect(buildAnthropicUrl(auth!)).toBe("https://foundry.example.com/anthropic/v1/messages?beta=true");
				},
			);
		} finally {
			store.close();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("keeps non-Foundry OAuth precedence unchanged", async () => {
		const tmpDir = path.join(os.tmpdir(), `pi-ai-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		fs.mkdirSync(tmpDir, { recursive: true });
		const dbPath = path.join(tmpDir, "agent.db");
		const store = await AuthCredentialStore.open(dbPath);
		try {
			store.replaceAuthCredentialsForProvider("anthropic", [
				{ type: "oauth", access: "sk-ant-oat-db", refresh: "refresh", expires: Date.now() + 20 * 60 * 1000 },
			]);
			await withEnv(
				{
					CLAUDE_CODE_USE_FOUNDRY: undefined,
					ANTHROPIC_FOUNDRY_API_KEY: "foundry-explicit-key",
					ANTHROPIC_API_KEY: "sk-ant-api-env",
					ANTHROPIC_OAUTH_TOKEN: undefined,
				},
				async environment => {
					const auth = await findAnthropicAuth({ store, environment });
					expect(auth).not.toBeNull();
					expect(auth?.apiKey).toBe("sk-ant-oat-db");
					expect(auth?.isOAuth).toBe(true);
					expect(auth?.baseUrl).toBe("https://api.anthropic.com");
				},
			);
		} finally {
			store.close();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("prefers stored API key over generic env fallback", async () => {
		const tmpDir = path.join(os.tmpdir(), `pi-ai-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		fs.mkdirSync(tmpDir, { recursive: true });
		const dbPath = path.join(tmpDir, "agent.db");
		const store = await AuthCredentialStore.open(dbPath);
		try {
			store.replaceAuthCredentialsForProvider("anthropic", [{ type: "api_key", key: "sk-ant-api-db" }]);
			await withEnv(
				{
					CLAUDE_CODE_USE_FOUNDRY: undefined,
					ANTHROPIC_FOUNDRY_API_KEY: undefined,
					ANTHROPIC_API_KEY: "sk-ant-api-env",
					ANTHROPIC_BASE_URL: "https://anthropic.example.com/",
					ANTHROPIC_OAUTH_TOKEN: undefined,
				},
				async environment => {
					const auth = await findAnthropicAuth({ store, environment });
					expect(auth).not.toBeNull();
					expect(auth?.apiKey).toBe("sk-ant-api-db");
					expect(auth?.isOAuth).toBe(false);
					expect(auth?.baseUrl).toBe("https://anthropic.example.com");
				},
			);
		} finally {
			store.close();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
