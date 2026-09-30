import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { metaOAuth } from "../src/utils/oauth/meta";
import { createRadiusOAuth } from "../src/utils/oauth/radius";
import { startOAuthCallbackServer } from "../src/utils/oauth/radius-callback";

describe("upstream OAuth device and callback flows", () => {
	it("completes Meta device sign-in and mints inference credentials", async () => {
		const requests: string[] = [];
		using _hook = hookFetch(async input => {
			const url = String(input);
			requests.push(url);
			if (url.includes("/authorization/"))
				return Response.json({
					device_code: "synthetic-device",
					user_code: "SYNTHETIC",
					verification_uri: "https://auth.example.com",
					interval: 0.001,
					expires_in: 30,
				});
			if (url.includes("/token/")) return Response.json({ access_token: "synthetic-identity" });
			return Response.json({ api_key: "synthetic-minted" });
		});
		let auth: unknown;
		const credential = await metaOAuth.login({
			signal: AbortSignal.timeout(5000),
			onAuth: info => {
				auth = info;
			},
			onPrompt: async () => "",
		});
		expect(auth).toMatchObject({ kind: "device", userCode: "SYNTHETIC" });
		expect(credential).toMatchObject({ access: "synthetic-minted", refresh: "synthetic-identity" });
		expect(requests).toHaveLength(3);
	});
	it("completes Radius device grants and rejects malformed credentials", async () => {
		let malformed = false;
		using _hook = hookFetch(async input =>
			String(input).endsWith("/device")
				? Response.json({
						device_code: "synthetic-device",
						user_code: "SYNTHETIC",
						verification_uri: "https://auth.example.com",
						expires_in: 30,
					})
				: Response.json(
						malformed
							? {}
							: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 },
					),
		);
		const oauth = createRadiusOAuth({ name: "Radius", gateway: "https://radius.example.com" });
		const credential = await oauth.login({
			method: "device",
			signal: AbortSignal.timeout(5000),
			onAuth() {},
			onPrompt: async () => "",
		});
		expect(credential).toMatchObject({ access: "synthetic-access" });
		malformed = true;
		await expect(
			oauth.refreshToken!({ access: "old", refresh: "synthetic-refresh", expires: 0 }, AbortSignal.timeout(5000)),
		).rejects.toThrow("Malformed");
	});
	it("correlates loopback state, rejects duplicate callbacks and cleans up cancellation", async () => {
		let exchanges = 0;
		const callback = await startOAuthCallbackServer({
			providerName: "Synthetic",
			host: "127.0.0.1",
			port: 0,
			path: "/callback",
			state: "synthetic-state",
			complete: async code => {
				exchanges++;
				return code;
			},
		});
		try {
			expect((await fetch(`${callback.redirectUri}?state=wrong&code=synthetic`)).status).toBe(400);
			expect((await fetch(`${callback.redirectUri}?state=synthetic-state&code=synthetic`)).status).toBe(200);
			expect(await callback.wait()).toBe("synthetic");
			expect((await fetch(`${callback.redirectUri}?state=synthetic-state&code=again`)).status).toBe(409);
			expect(exchanges).toBe(1);
		} finally {
			callback.close();
		}
		const controller = new AbortController();
		const cancelled = await startOAuthCallbackServer({
			providerName: "Synthetic",
			host: "127.0.0.1",
			port: 0,
			path: "/callback",
			signal: controller.signal,
			complete: async code => code,
		});
		try {
			controller.abort();
			await expect(cancelled.wait()).rejects.toThrow("cancelled");
		} finally {
			cancelled.close();
		}
	});
});
