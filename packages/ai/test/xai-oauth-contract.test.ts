import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getOAuthApiKey, getOAuthProvider } from "../src/utils/oauth";

describe("xAI OAuth subscription", () => {
	it("refreshes through xcsh authentication and retains a nonrotated refresh token", async () => {
		let form: URLSearchParams | undefined;
		using _hook = hookFetch(async (_url, init) => {
			form = new URLSearchParams(String(init?.body));
			return Response.json({ access_token: "synthetic-access", expires_in: 3600 });
		});
		expect(getOAuthProvider("xai")).toBeDefined();
		const result = await getOAuthApiKey("xai", {
			xai: { access: "expired", refresh: "synthetic-refresh", expires: 0 },
		});
		expect(result?.apiKey).toBe("synthetic-access");
		expect(result?.newCredentials.refresh).toBe("synthetic-refresh");
		expect(form?.get("grant_type")).toBe("refresh_token");
	});
	it("cancels before requesting credentials", async () => {
		let calls = 0;
		using _hook = hookFetch(async () => {
			calls++;
			return Response.json({});
		});
		await expect(
			getOAuthProvider("xai")!.login({ signal: AbortSignal.abort(), onAuth() {}, onPrompt: async () => "" }),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
});
