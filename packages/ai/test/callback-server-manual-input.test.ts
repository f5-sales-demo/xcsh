import { describe, expect, it } from "bun:test";
import { OAuthCallbackFlow } from "../src/utils/oauth/callback-server";
import type { OAuthCredentials } from "../src/utils/oauth/types";

class TestCallbackFlow extends OAuthCallbackFlow {
	async generateAuthUrl(_state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		return { url: `${redirectUri}?start=1&state=${encodeURIComponent(_state)}` };
	}

	async exchangeToken(code: string, _state: string, _redirectUri: string): Promise<OAuthCredentials> {
		return {
			access: `access-${code}`,
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
		};
	}
}

describe("OAuthCallbackFlow manual input retries", () => {
	it("accepts an IPv4 loopback callback for the default localhost redirect URI", async () => {
		const flow = new TestCallbackFlow(
			{
				onAuth: ({ url }) => {
					const redirectUri = new URL(url);
					const state = redirectUri.searchParams.get("state");
					queueMicrotask(async () => {
						await fetch(
							`http://127.0.0.1:${redirectUri.port}/callback?code=ipv4-code&state=${encodeURIComponent(state ?? "")}`,
						);
					});
				},
				signal: AbortSignal.timeout(1_000),
			},
			0,
		);

		const credentials = await flow.login();

		expect(credentials.access).toBe("access-ipv4-code");
	});

	it("retries manual input until a valid callback payload is provided", async () => {
		const attempts = ["http://localhost/callback?state=missing-code", "http://localhost/callback?code=valid-code"];
		let promptCount = 0;

		const flow = new TestCallbackFlow(
			{
				onAuth: () => {},
				onManualCodeInput: async () => {
					const value = attempts[promptCount];
					promptCount += 1;
					if (!value) {
						throw new Error("unexpected extra manual input request");
					}
					return value;
				},
				signal: AbortSignal.timeout(1_000),
			},
			14555,
		);

		const credentials = await flow.login();

		expect(promptCount).toBe(2);
		expect(credentials.access).toBe("access-valid-code");
	});

	it("retries when manual callback state does not match", async () => {
		const attempts = [
			"http://localhost/callback?code=first-code&state=wrong-state",
			"http://localhost/callback?code=second-code",
		];
		let promptCount = 0;

		const flow = new TestCallbackFlow(
			{
				onAuth: () => {},
				onManualCodeInput: async () => {
					const value = attempts[promptCount];
					promptCount += 1;
					if (!value) {
						throw new Error("unexpected extra manual input request");
					}
					return value;
				},
				signal: AbortSignal.timeout(1_000),
			},
			14556,
		);

		const credentials = await flow.login();

		expect(promptCount).toBe(2);
		expect(credentials.access).toBe("access-second-code");
	});
});
