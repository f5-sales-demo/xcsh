/** Anthropic OAuth flow for Claude subscriptions (Claude Pro/Max). */
import { generatePKCE } from "./pkce";
import type { OAuthAuthInfo, OAuthController, OAuthCredentials } from "./types";

const decode = (value: string) => atob(value);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const MANUAL_REDIRECT_URL = "https://platform.claude.com/oauth/code/callback";
const CALLBACK_PATH = "/callback";
const SCOPES = "user:profile user:inference";
const LOGIN_TIMEOUT_MS = 300_000;
const TOKEN_TIMEOUT_MS = 30_000;

export interface AnthropicOAuthFlowOptions {
	timeoutMs?: number;
}

interface AnthropicTokenPayload {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
	account_uuid?: unknown;
	email_address?: unknown;
	account?: unknown;
}

function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function authorizationUrl(redirectUri: string, state: string, challenge: string): string {
	const params = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

function parseManualCode(input: string, expectedState: string): string {
	const value = input.trim();
	let code: string | undefined;
	let state: string | undefined;
	try {
		const url = new URL(value);
		code = url.searchParams.get("code") ?? undefined;
		state = url.searchParams.get("state") ?? undefined;
	} catch {
		const separator = value.lastIndexOf("#");
		if (separator > 0) {
			code = value.slice(0, separator);
			state = value.slice(separator + 1);
		}
	}
	if (!code || !state) throw new Error("Manual authorization requires code#state");
	if (state !== expectedState) throw new Error("OAuth state mismatch");
	return code;
}

function tokenCredentials(payload: AnthropicTokenPayload, previousRefresh?: string): OAuthCredentials {
	if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
		throw new Error("Anthropic token response was missing required fields");
	}
	const refresh =
		typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : previousRefresh;
	if (!refresh) throw new Error("Anthropic token response was missing a refresh token");
	const account =
		payload.account && typeof payload.account === "object" && !Array.isArray(payload.account)
			? (payload.account as Record<string, unknown>)
			: undefined;
	const accountId =
		typeof account?.uuid === "string"
			? account.uuid
			: typeof account?.id === "string"
				? account.id
				: typeof payload.account_uuid === "string"
					? payload.account_uuid
					: undefined;
	const email =
		typeof account?.email_address === "string"
			? account.email_address
			: typeof account?.email === "string"
				? account.email
				: typeof payload.email_address === "string"
					? payload.email_address
					: undefined;
	return {
		access: payload.access_token,
		refresh,
		expires: Date.now() + payload.expires_in * 1000 - 5 * 60 * 1000,
		...(accountId && { accountId }),
		...(email && { email }),
	};
}

async function requestToken(body: Record<string, string>, previousRefresh?: string): Promise<OAuthCredentials> {
	let response: Response;
	try {
		response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError") {
			throw new Error("Anthropic token exchange timed out after 30 seconds");
		}
		throw new Error("Anthropic token exchange failed");
	}
	if (!response.ok) throw new Error(`Anthropic token exchange failed (HTTP ${response.status})`);
	let payload: AnthropicTokenPayload;
	try {
		payload = (await response.json()) as AnthropicTokenPayload;
	} catch {
		throw new Error("Anthropic token response was invalid");
	}
	return tokenCredentials(payload, previousRefresh);
}

export class AnthropicOAuthFlow {
	#verifier = "";
	#challenge = "";
	readonly #timeoutMs: number;

	constructor(
		readonly ctrl: OAuthController,
		options: AnthropicOAuthFlowOptions = {},
	) {
		this.#timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
	}

	async generateAuthInfo(state: string, loopbackRedirectUri: string): Promise<OAuthAuthInfo & { openUrl: string }> {
		if (!this.#verifier) {
			const pkce = await generatePKCE();
			this.#verifier = pkce.verifier;
			this.#challenge = pkce.challenge;
		}
		return {
			url: authorizationUrl(MANUAL_REDIRECT_URL, state, this.#challenge),
			openUrl: authorizationUrl(loopbackRedirectUri, state, this.#challenge),
			instructions: "For a remote or headless terminal, open the displayed URL and paste the resulting code#state.",
		};
	}

	/** Backward-compatible helper for callers that only need one redirect URL. */
	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		if (!this.#verifier) {
			const pkce = await generatePKCE();
			this.#verifier = pkce.verifier;
			this.#challenge = pkce.challenge;
		}
		return { url: authorizationUrl(redirectUri, state, this.#challenge) };
	}

	async exchangeToken(codeInput: string, expectedState: string, redirectUri: string): Promise<OAuthCredentials> {
		if (!this.#verifier) throw new Error("Anthropic OAuth exchange started without PKCE");
		let code = codeInput;
		const fragment = codeInput.lastIndexOf("#");
		if (fragment >= 0) {
			code = codeInput.slice(0, fragment);
			const suppliedState = codeInput.slice(fragment + 1);
			if (!suppliedState || suppliedState !== expectedState) throw new Error("OAuth state mismatch");
		}
		if (!code) throw new Error("Missing authorization code");
		return requestToken({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state: expectedState,
			redirect_uri: redirectUri,
			code_verifier: this.#verifier,
		});
	}

	async login(): Promise<OAuthCredentials> {
		if (this.ctrl.signal?.aborted) throw new Error("Anthropic login cancelled");
		const state = generateState();
		const completed = Promise.withResolvers<{ code: string; redirectUri: string }>();
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: request => {
				const url = new URL(request.url);
				if (url.pathname !== CALLBACK_PATH) return new Response("Not Found", { status: 404 });
				const code = url.searchParams.get("code");
				const callbackState = url.searchParams.get("state");
				if (!code || callbackState !== state) {
					completed.reject(
						new Error(callbackState ? "OAuth state mismatch" : "Missing authorization code or state"),
					);
					return new Response("Authorization failed. Return to the terminal.", { status: 400 });
				}
				completed.resolve({ code, redirectUri: loopbackRedirectUri });
				return new Response("Authorization complete. Return to the terminal.");
			},
		});
		// Claude's registered native-client redirect uses localhost, while the
		// listener remains explicitly bound to 127.0.0.1.
		const loopbackRedirectUri = `http://localhost:${server.port}${CALLBACK_PATH}`;
		try {
			const authInfo = await this.generateAuthInfo(state, loopbackRedirectUri);
			this.ctrl.onAuth?.(authInfo);
			this.ctrl.onProgress?.("Waiting for Claude subscription authorization…");
			const attempts: Promise<{ code: string; redirectUri: string }>[] = [completed.promise];
			if (this.ctrl.onManualCodeInput) {
				attempts.push(
					this.ctrl.onManualCodeInput().then(input => ({
						code: parseManualCode(input, state),
						redirectUri: MANUAL_REDIRECT_URL,
					})),
				);
			}
			const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
			const signal = this.ctrl.signal ? AbortSignal.any([this.ctrl.signal, timeoutSignal]) : timeoutSignal;
			const aborted = new Promise<never>((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() =>
						reject(
							new Error(this.ctrl.signal?.aborted ? "Anthropic login cancelled" : "Anthropic login timed out"),
						),
					{ once: true },
				);
			});
			const result = await Promise.race([...attempts, aborted]);
			this.ctrl.onProgress?.("Exchanging authorization code for tokens…");
			return await this.exchangeToken(result.code, state, result.redirectUri);
		} finally {
			server.stop();
		}
	}
}

export async function loginAnthropic(
	ctrl: OAuthController,
	options: AnthropicOAuthFlowOptions = {},
): Promise<OAuthCredentials> {
	return new AnthropicOAuthFlow(ctrl, options).login();
}

export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
	return requestToken(
		{
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: refreshToken,
		},
		refreshToken,
	);
}
