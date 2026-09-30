import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { openRouterOAuth } from "../src/utils/oauth/openrouter";

describe("OpenRouter PKCE authentication", () => {
	it("exchanges a loopback authorization code for a permanent API key", async () => {
		let payload: any;
		using _hook = hookFetch(async (input, init, next) => {
			if (!String(input).includes("openrouter.ai")) return next(input, init);
			payload = JSON.parse(String(init?.body));
			return Response.json({ key: "synthetic-permanent-key" });
		});
		const key = await openRouterOAuth.login({
			signal: AbortSignal.timeout(5000),
			onAuth: info => {
				const callback = new URL(info.url).searchParams.get("callback_url")!;
				void fetch(`${callback}?code=synthetic-code`).catch(() => undefined);
			},
			onPrompt: async () => "synthetic-code",
		});
		expect(key).toBe("synthetic-permanent-key");
		expect(payload).toMatchObject({ code: "synthetic-code", code_challenge_method: "S256" });
		expect(typeof payload.code_verifier).toBe("string");
	});
	it("rejects pre-aborted sign-in before requesting credentials", async () => {
		await expect(
			openRouterOAuth.login({ signal: AbortSignal.abort(), onAuth() {}, onPrompt: async () => "" }),
		).rejects.toThrow();
	});
});
