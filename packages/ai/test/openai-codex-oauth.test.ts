import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	createOpenAICodexAuthorizationUrl,
	formatOpenAICodexTokenEndpointError,
	getOpenAICodexLoginMethods,
	loginOpenAICodex,
	loginOpenAICodexDevice,
	OpenAICodexDeviceUnavailableError,
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

	it("tries both registered callback ports and fails clearly when both are busy", async () => {
		const serve = vi.spyOn(Bun, "serve").mockImplementation(options => {
			expect([1455, 1457]).toContain(options.port as number);
			throw new Error("EADDRINUSE");
		});

		await expect(
			loginOpenAICodex({
				method: "browser",
				onAuth: vi.fn(),
				onPrompt: async () => "",
			}),
		).rejects.toThrow("OAuth callback ports 1455, 1457 are unavailable");
		expect(serve).toHaveBeenCalledTimes(2);
	});

	it("retains useful token endpoint detail while redacting credentials and query strings", () => {
		const detail = formatOpenAICodexTokenEndpointError(
			400,
			JSON.stringify({
				error: "invalid_grant",
				error_description:
					"authorization expired; retry https://localhost/callback?code=secret-code&state=secret-state access_token=secret-token code_verifier=secret-verifier device_auth_id=secret-device",
			}),
		);

		expect(detail).toContain("400 invalid_grant: authorization expired");
		expect(detail).not.toContain("secret-code");
		expect(detail).not.toContain("secret-state");
		expect(detail).not.toContain("secret-token");
		expect(detail).not.toContain("secret-verifier");
		expect(detail).not.toContain("secret-device");
		expect(detail).toContain("[REDACTED]");
	});
});

describe("OpenAI Codex login method", () => {
	it("selects device authorization only for SSH and interactive headless Linux", () => {
		expect(shouldUseOpenAICodexDeviceFlow({ SSH_CONNECTION: "client server" }, "linux", true)).toBe(true);
		expect(shouldUseOpenAICodexDeviceFlow({ SSH_TTY: "/dev/pts/1" }, "linux", true)).toBe(true);
		expect(shouldUseOpenAICodexDeviceFlow({}, "linux", true)).toBe(true);
		expect(shouldUseOpenAICodexDeviceFlow({ DISPLAY: ":0" }, "linux", true)).toBe(false);
		expect(shouldUseOpenAICodexDeviceFlow({ WAYLAND_DISPLAY: "wayland-0" }, "linux", true)).toBe(false);
		expect(shouldUseOpenAICodexDeviceFlow({}, "darwin", true)).toBe(false);
		expect(shouldUseOpenAICodexDeviceFlow({ SSH_CONNECTION: "client server" }, "darwin", true)).toBe(true);
		expect(resolveOpenAICodexLoginMethod("auto", { SSH_CONNECTION: "client server" }, "linux", true)).toBe("device");
		expect(resolveOpenAICodexLoginMethod("browser", { SSH_CONNECTION: "client server" }, "linux", true)).toBe(
			"browser",
		);
	});

	it("orders browser first locally and device code first over SSH", () => {
		expect(getOpenAICodexLoginMethods({ DISPLAY: ":0" }, "linux", true)).toEqual(["browser", "device"]);
		expect(getOpenAICodexLoginMethods({ SSH_CONNECTION: "client server" }, "linux", true)).toEqual([
			"device",
			"browser",
		]);
	});

	it("offers browser/manual redirect fallback in the same flow when device authorization is unavailable", async () => {
		const credentials = { access: "access", refresh: "refresh", expires: 123, accountId: "acct" };
		const deviceLogin = vi.fn(async () => {
			throw new OpenAICodexDeviceUnavailableError();
		});
		const browserLogin = vi.fn(async options => {
			expect(options.onManualCodeInput).toBeDefined();
			return credentials;
		});
		const onPrompt = vi.fn(async () => "yes");

		await expect(
			loginOpenAICodex(
				{ method: "device", onPrompt, onManualCodeInput: async () => "https://localhost/?code=x" },
				{ deviceLogin, browserLogin },
			),
		).resolves.toEqual(credentials);
		expect(onPrompt).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("browser") }));
		expect(browserLogin).toHaveBeenCalledTimes(1);
	});

	it("cancels device-unavailable fallback without starting browser authentication", async () => {
		const browserLogin = vi.fn();
		await expect(
			loginOpenAICodex(
				{ method: "device", onPrompt: async () => "no" },
				{
					deviceLogin: async () => {
						throw new OpenAICodexDeviceUnavailableError();
					},
					browserLogin,
				},
			),
		).rejects.toThrow("ChatGPT login cancelled");
		expect(browserLogin).not.toHaveBeenCalled();
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
			instructions: "Enter this one-time code in the browser. Never share it with anyone.",
			kind: "device",
			userCode: "ABCD-EFGH",
			expiresInSeconds: 900,
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
		});
		expect(credentials).not.toHaveProperty("email");
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

	it("explains when device login is disabled for the ChatGPT account or workspace", async () => {
		const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;

		await expect(loginOpenAICodexDevice({}, { fetch: fetchImpl })).rejects.toThrow(
			"Device-code login is not enabled for this ChatGPT account or workspace",
		);
	});
});
