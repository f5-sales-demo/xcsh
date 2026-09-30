import { generatePKCE } from "./pkce";
import { startOAuthCallbackServer } from "./radius-callback";
import type { OAuthProviderInterface } from "./types";

/** PKCE returns a permanent user-controlled key; xcsh persists it through its API-key path. */
export const openRouterOAuth: OAuthProviderInterface = {
	id: "openrouter",
	name: "OpenRouter OAuth",
	async login(callbacks) {
		const signal = callbacks.signal ?? AbortSignal.timeout(300_000);
		signal.throwIfAborted();
		const { verifier, challenge } = await generatePKCE();
		const exchange = async (code: string) => {
			const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
				method: "POST",
				headers: { Accept: "application/json", "Content-Type": "application/json" },
				body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
				signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
			});
			if (!response.ok) throw new Error(`OpenRouter OAuth exchange HTTP ${response.status}`);
			const body = (await response.json()) as { key?: unknown };
			if (typeof body.key !== "string" || !body.key) throw new Error("Malformed OpenRouter OAuth key");
			return body.key;
		};
		const callback = await startOAuthCallbackServer({
			providerName: "OpenRouter",
			host: "127.0.0.1",
			port: 0,
			path: `/oauth/callback/${crypto.randomUUID()}`,
			complete: exchange,
			signal,
			timeoutMs: 300_000,
		});
		try {
			const url = new URL("https://openrouter.ai/auth");
			url.search = new URLSearchParams({
				callback_url: callback.redirectUri,
				code_challenge: challenge,
				code_challenge_method: "S256",
			}).toString();
			callbacks.onAuth({
				url: url.toString(),
				instructions: "Complete browser sign-in. Remote sessions can paste the redirect URL.",
			});
			if (!process.env.SSH_CONNECTION)
				return (
					(await callback.wait()) ??
					(() => {
						throw new Error("Login cancelled");
					})()
				);
			const input = await (callbacks.onManualCodeInput?.() ??
				callbacks.onPrompt({ message: "Paste the authorization code or redirect URL:" }));
			signal.throwIfAborted();
			let code = input.trim();
			try {
				code = new URL(code).searchParams.get("code") ?? "";
			} catch {}
			if (!code) throw new Error("Missing authorization code");
			callback.cancel();
			return await exchange(code);
		} finally {
			callback.close();
		}
	},
};
