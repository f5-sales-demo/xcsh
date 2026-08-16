import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	createOpenAICodexAuthorizationUrl,
	formatOpenAICodexTokenEndpointError,
	loginOpenAICodex,
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
	});
});
