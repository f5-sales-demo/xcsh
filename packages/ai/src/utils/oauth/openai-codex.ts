/**
 * OpenAI Codex (ChatGPT OAuth) flow.
 */
import { isRecord } from "../../utils";
import { OAuthCallbackFlow, type OAuthCallbackFlowOptions } from "./callback-server";
import { generatePKCE } from "./pkce";
import type { OAuthController, OAuthCredentials } from "./types";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const CALLBACK_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const JWT_PROFILE_CLAIM = "https://api.openai.com/profile";
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

/** Prefer callback-free authentication when xcsh is running in a remote terminal. */
export function shouldUseOpenAICodexDeviceFlow(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	isInteractive = Boolean(process.stdin.isTTY),
): boolean {
	if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
	return platform === "linux" && isInteractive && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

type JwtPayload = {
	[JWT_CLAIM_PATH]?: {
		chatgpt_account_id?: string;
	};
	[JWT_PROFILE_CLAIM]?: {
		email?: string;
	};
	[key: string]: unknown;
};

function decodeJwt(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

function getTokenProfile(accessToken: string): { accountId?: string; email?: string } {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[JWT_CLAIM_PATH];
	const accountId = auth?.chatgpt_account_id;
	const email = payload?.[JWT_PROFILE_CLAIM]?.email?.trim().toLowerCase();
	return {
		accountId: typeof accountId === "string" && accountId.length > 0 ? accountId : undefined,
		email: typeof email === "string" && email.length > 0 ? email : undefined,
	};
}

interface PKCE {
	verifier: string;
	challenge: string;
}

function describeTokenEndpointValue(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (!isRecord(value)) return undefined;

	const code = describeTokenEndpointValue(value.code ?? value.error);
	const message = describeTokenEndpointValue(value.message ?? value.error_description ?? value.description);
	if (code && message && code !== message) return `${code}: ${message}`;
	return code ?? message;
}

function redactTokenEndpointDetail(detail: string): string {
	return detail
		.replace(/(https?:\/\/[^\s?]+)\?[^\s)]+/gi, "$1?[REDACTED]")
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(
			/\b(access_token|refresh_token|id_token|authorization_code|code|token|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1$2[REDACTED]",
		)
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
		.slice(0, 500);
}

/** Format useful OAuth token endpoint failures without echoing credentials or callback query strings. */
export function formatOpenAICodexTokenEndpointError(status: number, bodyText: string): string {
	const trimmed = bodyText.trim();
	if (trimmed.length === 0) return `${status}`;

	let detail: string | undefined;
	try {
		const body: unknown = JSON.parse(trimmed);
		if (isRecord(body)) {
			const error = describeTokenEndpointValue(body.error);
			const description = describeTokenEndpointValue(body.error_description);
			const message = describeTokenEndpointValue(body.message);
			detail =
				error && description && error !== description
					? `${error}: ${description}`
					: (error ?? description ?? message);
		} else {
			detail = describeTokenEndpointValue(body);
		}
	} catch {
		detail = trimmed;
	}

	return detail ? `${status} ${redactTokenEndpointDetail(detail)}` : `${status}`;
}

/** Build the browser OAuth URL; exported for regression coverage. */
export function createOpenAICodexAuthorizationUrl(args: {
	state: string;
	redirectUri: string;
	challenge: string;
	originator?: string;
}): string {
	const searchParams = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: args.redirectUri,
		scope: SCOPE,
		code_challenge: args.challenge,
		code_challenge_method: "S256",
		state: args.state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: args.originator?.trim() || "pi",
	});

	return `${AUTHORIZE_URL}?${searchParams.toString()}`;
}

class OpenAICodexOAuthFlow extends OAuthCallbackFlow {
	constructor(
		ctrl: OAuthController,
		private readonly pkce: PKCE,
		private readonly originator: string,
	) {
		super(ctrl, {
			preferredPort: CALLBACK_PORT,
			callbackPath: CALLBACK_PATH,
			redirectUri: CALLBACK_URI,
		} satisfies OAuthCallbackFlowOptions);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		return {
			url: createOpenAICodexAuthorizationUrl({
				state,
				redirectUri,
				challenge: this.pkce.challenge,
				originator: this.originator,
			}),
			instructions: "A browser window should open. Complete login to finish.",
		};
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		return exchangeCodeForToken(code, this.pkce.verifier, redirectUri);
	}
}

async function exchangeCodeForToken(code: string, verifier: string, redirectUri: string): Promise<OAuthCredentials> {
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
	});

	if (!tokenResponse.ok) {
		const bodyText = await tokenResponse.text();
		throw new Error(`Token exchange failed: ${formatOpenAICodexTokenEndpointError(tokenResponse.status, bodyText)}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!tokenData.access_token || !tokenData.refresh_token || typeof tokenData.expires_in !== "number") {
		throw new Error("Token response missing required fields");
	}

	const { accountId, email } = getTokenProfile(tokenData.access_token);
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}

	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token,
		expires: Date.now() + tokenData.expires_in * 1000,
		accountId,
		email,
	};
}

export type OpenAICodexLoginOptions = OAuthController & {
	/** Optional originator value. The default matches xcsh Codex request headers. */
	originator?: string;
};

export async function loginOpenAICodex(options: OpenAICodexLoginOptions): Promise<OAuthCredentials> {
	const pkce = await generatePKCE();
	const originator = options.originator?.trim() || "pi";
	const flow = new OpenAICodexOAuthFlow(options, pkce, originator);
	return flow.login();
}

export async function refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
	});

	if (!response.ok) {
		const bodyText = await response.text();
		throw new Error(
			`OpenAI Codex token refresh failed: ${formatOpenAICodexTokenEndpointError(response.status, bodyText)}`,
		);
	}

	const tokenData = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!tokenData.access_token || typeof tokenData.expires_in !== "number") {
		throw new Error("Token response missing required fields");
	}

	const { accountId, email } = getTokenProfile(tokenData.access_token);
	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token || refreshToken,
		expires: Date.now() + tokenData.expires_in * 1000,
		accountId,
		email,
	};
}
