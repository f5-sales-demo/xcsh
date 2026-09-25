import { afterEach, describe, expect, it, vi } from "bun:test";
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

afterEach(() => {
	vi.restoreAllMocks();
});

function createMockCallbackFlow(port: number): TestCallbackFlow {
	return new TestCallbackFlow(
		{
			onAuth: () => {},
			onManualCodeInput: async () => "manual-code",
			signal: AbortSignal.timeout(1_000),
		},
		{
			preferredPort: port,
			redirectUri: `http://localhost:${port}/callback`,
		},
	);
}

describe("OAuthCallbackFlow manual input retries", () => {
	it("uses a provider-specific callback timeout", async () => {
		const timeout = vi.spyOn(AbortSignal, "timeout");
		const flow = new TestCallbackFlow(
			{
				onAuth: () => {},
				onManualCodeInput: async () => "hosted-code",
			},
			{
				preferredPort: 14553,
				redirectUri: "https://example.test/oauth-callback",
				manualOnly: true,
				timeoutMs: 900_000,
			},
		);

		await flow.login();

		expect(timeout).toHaveBeenCalledWith(900_000);
		timeout.mockRestore();
	});

	it("does not bind a callback listener for manual-only hosted redirects", async () => {
		const serve = vi.spyOn(Bun, "serve");
		const flow = new TestCallbackFlow(
			{
				onAuth: () => {},
				onManualCodeInput: async () => "hosted-code",
				signal: AbortSignal.timeout(1_000),
			},
			{
				preferredPort: 14554,
				redirectUri: "https://example.test/oauth-callback",
				manualOnly: true,
			},
		);

		const credentials = await flow.login();

		expect(credentials.access).toBe("access-hosted-code");
		expect(serve).not.toHaveBeenCalled();
		serve.mockRestore();
	});

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

	for (const errorCode of ["EADDRNOTAVAIL", "EAFNOSUPPORT"]) {
		it(`keeps the IPv4 listener when the IPv6 loopback fails with ${errorCode}`, async () => {
			const ipv4Stop = vi.fn();
			const serve = vi.spyOn(Bun, "serve").mockImplementation(options => {
				if (options.hostname === "127.0.0.1") {
					return { port: 14557, stop: ipv4Stop } as unknown as ReturnType<typeof Bun.serve>;
				}
				throw Object.assign(new Error("IPv6 loopback unavailable"), { code: errorCode });
			});

			const credentials = await createMockCallbackFlow(14557).login();

			expect(credentials.access).toBe("access-manual-code");
			expect(serve).toHaveBeenCalledTimes(2);
			expect(ipv4Stop).toHaveBeenCalledTimes(1);
		});
	}

	it("stops both listeners after a dual-stack callback flow", async () => {
		const ipv4Stop = vi.fn();
		const ipv6Stop = vi.fn();
		const serve = vi.spyOn(Bun, "serve").mockImplementation(options => {
			const stop = options.hostname === "127.0.0.1" ? ipv4Stop : ipv6Stop;
			return { port: 14558, stop } as unknown as ReturnType<typeof Bun.serve>;
		});

		await createMockCallbackFlow(14558).login();

		expect(serve).toHaveBeenCalledTimes(2);
		expect(ipv4Stop).toHaveBeenCalledTimes(1);
		expect(ipv6Stop).toHaveBeenCalledTimes(1);
	});

	for (const errorCode of ["EADDRINUSE", "EPERM"]) {
		it(`rejects ${errorCode} from the IPv6 listener and cleans up IPv4`, async () => {
			const ipv4Stop = vi.fn();
			vi.spyOn(Bun, "serve").mockImplementation(options => {
				if (options.hostname === "127.0.0.1") {
					return { port: 14559, stop: ipv4Stop } as unknown as ReturnType<typeof Bun.serve>;
				}
				throw Object.assign(new Error("IPv6 bind failed"), { code: errorCode });
			});

			await expect(createMockCallbackFlow(14559).login()).rejects.toThrow("OAuth callback port 14559 unavailable");
			expect(ipv4Stop).toHaveBeenCalledTimes(1);
		});
	}

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
