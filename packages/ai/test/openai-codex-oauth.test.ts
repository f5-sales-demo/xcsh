import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	createOpenAICodexAuthorizationUrl,
	formatOpenAICodexTokenEndpointError,
	loginOpenAICodex,
	loginOpenAICodexDevice,
	resolveOpenAICodexLoginMethod,
	shouldUseOpenAICodexDeviceFlow,
} from "../src/utils/oauth/openai-codex";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("OpenAI Codex browser OAuth", () => {
	it("builds the fixed PKCE authorization request with connector scopes and xcsh originator", () => {
		const authorizationUrl = new URL(
			createOpenAICodexAuthorizationUrl({
				state: "state-value",
				redirectUri: "http://localhost:1455/auth/callback",
				challenge: "pkce-challenge",
			}),
		);

		expect(authorizationUrl.origin + authorizationUrl.pathname).toBe("https://auth.openai.com/oauth/authorize");
		expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
		expect(authorizationUrl.searchParams.get("scope")).toBe(
			"openid profile email offline_access api.connectors.read api.connectors.invoke",
		);
		expect(authorizationUrl.searchParams.get("code_challenge")).toBe("pkce-challenge");
		expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorizationUrl.searchParams.get("state")).toBe("state-value");
		expect(authorizationUrl.searchParams.get("originator")).toBe("pi");
	});

	it("fails clearly when fixed callback port 1455 is busy", async () => {
		const serve = vi.spyOn(Bun, "serve").mockImplementation(options => {
			expect(options.port).toBe(1455);
			throw new Error("EADDRINUSE");
		});

		await expect(
			loginOpenAICodex({
				method: "browser",
				onAuth: vi.fn(),
				onPrompt: async () => "",
			}),
		).rejects.toThrow(
			"OAuth callback port 1455 unavailable; cannot fall back to a random port when oauth.redirectUri is set",
		);
		expect(serve).toHaveBeenCalledTimes(1);
	});

	it("retains useful token endpoint detail while redacting credentials and query strings", () => {
		const detail = formatOpenAICodexTokenEndpointError(
			400,
			JSON.stringify({
				error: "invalid_grant",
				error_description:
					"authorization expired; retry https://localhost/callback?code=secret-code&state=secret-state access_token=secret-token",
			}),
		);

		expect(detail).toContain("400 invalid_grant: authorization expired");
		expect(detail).not.toContain("secret-code");
		expect(detail).not.toContain("secret-state");
		expect(detail).not.toContain("secret-token");
		expect(detail).toContain("[REDACTED]");
	});
});

describe("OpenAI Codex login method", () => {
	it("defaults SSH sessions to device authorization without treating local terminals as remote", () => {
		expect(shouldUseOpenAICodexDeviceFlow({ SSH_CONNECTION: "client server" }, "linux", true)).toBe(true);
		expect(shouldUseOpenAICodexDeviceFlow({ SSH_TTY: "/dev/pts/1" }, "linux", true)).toBe(true);
		expect(shouldUseOpenAICodexDeviceFlow({}, "darwin", true)).toBe(false);
		expect(resolveOpenAICodexLoginMethod("auto", { SSH_CONNECTION: "client server" }, "linux", true)).toBe("device");
		expect(resolveOpenAICodexLoginMethod("browser", { SSH_CONNECTION: "client server" }, "linux", true)).toBe(
			"browser",
		);
	});
});

describe("OpenAI Codex device OAuth", () => {
	it("shows a short code, polls remotely, and returns normal Codex credentials without a callback listener", async () => {
		const encodeJwtPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
		const accessToken = `${encodeJwtPart({ alg: "none" })}.${encodeJwtPart({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-device" },
			"https://api.openai.com/profile": { email: "USER@example.com" },
		})}.signature`;
		const requests: Array<{ url: string; body: string }> = [];
		let pollCount = 0;
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, body: String(init?.body ?? "") });
			if (url.endsWith("/deviceauth/usercode")) {
				return Response.json({ device_auth_id: "device-secret", user_code: "ABCD-EFGH", interval: "5" });
			}
			if (url.endsWith("/deviceauth/token")) {
				pollCount += 1;
				return pollCount === 1
					? Response.json({ error: "authorization_pending" }, { status: 404 })
					: Response.json({ authorization_code: "authorization-secret", code_verifier: "verifier-secret" });
			}
			if (url.endsWith("/oauth/token")) {
				return Response.json({ access_token: accessToken, refresh_token: "refresh-secret", expires_in: 3600 });
			}
			throw new Error(`Unexpected request: ${url}`);
		}) as typeof fetch;
		const onAuth = vi.fn();
		const progress: string[] = [];

		const credentials = await loginOpenAICodexDevice(
			{ onAuth, onProgress: message => progress.push(message) },
			{ fetch: fetchImpl, sleep: async () => {} },
		);

		expect(onAuth).toHaveBeenCalledWith({
			url: "https://auth.openai.com/codex/device",
			instructions: "Enter this one-time code: ABCD-EFGH (expires in 15 minutes)",
		});
		expect(requests.map(request => request.url)).toEqual([
			"https://auth.openai.com/api/accounts/deviceauth/usercode",
			"https://auth.openai.com/api/accounts/deviceauth/token",
			"https://auth.openai.com/api/accounts/deviceauth/token",
			"https://auth.openai.com/oauth/token",
		]);
		expect(requests.some(request => request.url.includes("localhost:1455"))).toBe(false);
		expect(requests[3]?.body).toContain("redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback");
		expect(credentials).toMatchObject({
			access: accessToken,
			refresh: "refresh-secret",
			accountId: "acct-device",
			email: "user@example.com",
		});
		const visibleProgress = progress.join("\n");
		expect(visibleProgress).not.toContain("device-secret");
		expect(visibleProgress).not.toContain("authorization-secret");
		expect(visibleProgress).not.toContain("verifier-secret");
		expect(visibleProgress).not.toContain("refresh-secret");
	});

	it("backs off when the device endpoint asks the client to slow down", async () => {
		const accessToken = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-slow" } }),
		).toString("base64url")}.signature`;
		let pollCount = 0;
		const sleepDurations: number[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/deviceauth/usercode")) {
				return Response.json({ device_auth_id: "device-id", user_code: "SLOW-DOWN", interval: "1" });
			}
			if (url.endsWith("/deviceauth/token")) {
				pollCount += 1;
				return pollCount === 1
					? Response.json({ error: "slow_down", error_description: "poll less often" }, { status: 429 })
					: Response.json({ authorization_code: "code", code_verifier: "verifier" });
			}
			return Response.json({ access_token: accessToken, refresh_token: "refresh", expires_in: 3600 });
		}) as typeof fetch;

		await loginOpenAICodexDevice(
			{},
			{
				fetch: fetchImpl,
				sleep: async milliseconds => {
					sleepDurations.push(milliseconds);
				},
			},
		);

		expect(sleepDurations).toEqual([6_000]);
		expect(pollCount).toBe(2);
	});

	it("distinguishes denial and expiry while redacting server detail", async () => {
		for (const testCase of [
			{ error: "authorization_declined", expected: "Device authorization denied" },
			{ error: "expired_token", expected: "Device authorization expired" },
		]) {
			const fetchImpl = (async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith("/deviceauth/usercode")) {
					return Response.json({ device_auth_id: "device-id", user_code: "ABCD-EFGH", interval: "1" });
				}
				return Response.json(
					{
						error: testCase.error,
						error_description:
							"request rejected at https://auth.openai.com/codex/device?token=server-secret Bearer bearer-secret",
					},
					{ status: 401 },
				);
			}) as typeof fetch;

			const result = loginOpenAICodexDevice({}, { fetch: fetchImpl, sleep: async () => {} });
			await expect(result).rejects.toThrow(testCase.expected);
			await expect(result).rejects.not.toThrow("server-secret");
			await expect(result).rejects.not.toThrow("bearer-secret");
		}
	});

	it("cancels before making a device authorization request", async () => {
		const abortController = new AbortController();
		abortController.abort();
		const fetchImpl = vi.fn(async () => Response.json({})) as unknown as typeof fetch;

		await expect(loginOpenAICodexDevice({ signal: abortController.signal }, { fetch: fetchImpl })).rejects.toThrow(
			"Device authorization cancelled",
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
