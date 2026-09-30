import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getOAuthApiKey } from "../src/utils/oauth";
import { metaOAuth } from "../src/utils/oauth/meta";
import { createRadiusOAuth } from "../src/utils/oauth/radius";

describe("upstream subscription auth contracts", () => {
	it("refreshes Meta and Radius through the existing credential resolver", async () => {
		using _hook = hookFetch(async (input: string | URL | Request) =>
			String(input).includes("meta.ai")
				? Response.json({ api_key: "synthetic-minted" })
				: Response.json({
						access_token: "synthetic-radius",
						refresh_token: "synthetic-refresh",
						expires_in: 3600,
					}),
		);
		for (const provider of ["meta", "radius"] as const) {
			const result = await getOAuthApiKey(provider, {
				[provider]: { access: "expired", refresh: "synthetic-refresh", expires: 0 },
			});
			expect(result?.apiKey).toBe(provider === "meta" ? "synthetic-minted" : "synthetic-radius");
		}
	});
	it("re-mints a Meta API key and fails expired identities", async () => {
		let header: string | null = null;
		using _hook = hookFetch(async (_url, init) => {
			header = new Headers(init?.headers).get("authorization");
			return Response.json({ api_key: "synthetic-minted" });
		});
		const credential = await metaOAuth.refreshToken!(
			{ access: "old", refresh: "synthetic-identity", expires: 0 },
			new AbortController().signal,
		);
		expect(String(header)).toBe("Bearer synthetic-identity");
		expect(credential.access).toBe("synthetic-minted");
		expect(metaOAuth.getApiKey!(credential)).toBe("synthetic-minted");
		using _expired = hookFetch(async () => Response.json({ error: "expired" }, { status: 401 }));
		await expect(metaOAuth.refreshToken!(credential, new AbortController().signal)).rejects.toThrow(
			"session expired",
		);
	});
	it("refreshes Radius on its own gateway with exact OAuth grant fields", async () => {
		let url = "";
		let form: URLSearchParams;
		using _hook = hookFetch(async (input, init) => {
			url = String(input);
			form = new URLSearchParams(String(init?.body));
			return Response.json({
				access_token: "synthetic-access",
				refresh_token: "synthetic-refresh",
				expires_in: 3600,
			});
		});
		const oauth = createRadiusOAuth({ name: "Synthetic Radius", gateway: "https://radius.example.com" });
		const credential = await oauth.refreshToken!(
			{ access: "old", refresh: "synthetic-refresh", expires: 0 },
			new AbortController().signal,
		);
		expect(url).toBe("https://radius.example.com/v1/oauth/token");
		expect(form!.get("grant_type")).toBe("refresh_token");
		expect(form!.get("client_id")).toBe("pi-gateway");
		expect(credential.access).toBe("synthetic-access");
	});
	it("cancels sign-in before requesting device credentials", async () => {
		let calls = 0;
		using _hook = hookFetch(async (_url, init) => {
			calls++;
			init?.signal?.throwIfAborted();
			return Response.json({});
		});
		await expect(
			metaOAuth.login({ signal: AbortSignal.abort(), onAuth() {}, onPrompt: async () => "" }),
		).rejects.toThrow("Login cancelled");
		expect(calls).toBeLessThanOrEqual(1);
	});
});
