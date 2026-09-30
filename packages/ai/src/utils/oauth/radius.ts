/**
 * Radius gateway OAuth flow.
 *
 * Radius is a pi-messages gateway. OAuth client APIs live on the configured
 * gateway; only the interactive browser authorization endpoint is discovered.
 * Model catalog loading is owned by the Radius provider.
 *
 * NOTE: This module uses node:http (via callback-server.ts) for the OAuth callback server.
 * It is only intended for CLI use, not browser environments.
 */

function normalizeRadiusGatewayUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid Radius URL");
	return url.toString().replace(/\/+$/, "");
}

import { pollOAuthDeviceCodeFlow } from "./device-code";
import { generatePKCE } from "./pkce";
import { startOAuthCallbackServer } from "./radius-callback";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1456;
const CALLBACK_PATH = "/oauth/callback";
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const OAUTH_CLIENT_ID = "pi-gateway";
const OAUTH_SCOPE = "gateway offline_access";
const OAUTH_DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

type RadiusOAuthDiscovery = {
	authorizationEndpoint: string;
};

type DeviceAuthorizationResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval?: number;
};

async function loadRadiusOAuthDiscovery(gateway: string, signal: AbortSignal): Promise<RadiusOAuthDiscovery> {
	const response = await fetch(new URL("/v1/oauth", gateway), {
		headers: { accept: "application/json" },
		signal,
	});

	if (!response.ok) {
		throw new Error(
			`Could not load Radius OAuth config from ${gateway}: ${response.status} ${await response.text()}`,
		);
	}

	const discovery = (await response.json()) as Partial<RadiusOAuthDiscovery>;
	if (typeof discovery.authorizationEndpoint !== "string") {
		throw new Error(`Invalid Radius OAuth config from ${gateway}`);
	}
	return { authorizationEndpoint: discovery.authorizationEndpoint };
}

class OAuthResponseError extends Error {
	readonly status: number;
	readonly oauthError?: string;

	constructor(status: number, oauthError: string | undefined, description: string | undefined, message: string) {
		const detail = oauthError
			? description
				? `${oauthError}: ${description}`
				: oauthError
			: description || String(status);
		super(`${message}: ${detail}`);
		this.status = status;
		this.oauthError = oauthError;
	}
}

async function readOAuthResponseError(response: Response, message: string): Promise<OAuthResponseError> {
	const text = await response.text().catch(() => "");
	let oauthError: string | undefined;
	let description: string | undefined;

	if (text) {
		try {
			const data = JSON.parse(text) as { error?: unknown; error_description?: unknown };
			oauthError = typeof data.error === "string" ? data.error : undefined;
			description = typeof data.error_description === "string" ? data.error_description : undefined;
		} catch {
			description = text;
		}
	}

	return new OAuthResponseError(response.status, oauthError, description, message);
}

async function requestOAuthToken(
	gateway: string,
	body: URLSearchParams,
	signal: AbortSignal,
): Promise<OAuthCredentials> {
	let response: Response;
	try {
		response = await fetch(new URL("/v1/oauth/token", gateway), {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
			body,
			signal,
		});
	} catch (error) {
		if (signal.aborted) {
			throw new Error("Login cancelled");
		}
		throw error;
	}

	if (!response.ok) {
		throw await readOAuthResponseError(response, "Radius OAuth token request failed");
	}

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		scope?: string;
	};
	if (
		typeof data.access_token !== "string" ||
		!data.access_token ||
		typeof data.refresh_token !== "string" ||
		!data.refresh_token ||
		typeof data.expires_in !== "number" ||
		!Number.isFinite(data.expires_in) ||
		data.expires_in <= 0
	)
		throw new Error("Malformed Radius OAuth token response");

	return {
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_SKEW_MS,
	};
}

async function loginWithBrowser(
	gateway: string,
	authorizationEndpoint: string,
	interaction: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const state = crypto.randomUUID();
	const authorizeUrl = new URL(authorizationEndpoint);
	authorizeUrl.search = new URLSearchParams({
		response_type: "code",
		client_id: OAUTH_CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: OAUTH_SCOPE,
		code_challenge: challenge,
		code_challenge_method: "S256",
		handoff: "url",
		state,
	}).toString();

	const callback = await startOAuthCallbackServer({
		providerName: "Radius",
		host: CALLBACK_HOST,
		port: CALLBACK_PORT,
		path: CALLBACK_PATH,
		state,
		complete: code =>
			requestOAuthToken(
				gateway,
				new URLSearchParams({
					grant_type: "authorization_code",
					client_id: OAUTH_CLIENT_ID,
					redirect_uri: REDIRECT_URI,
					code,
					code_verifier: verifier,
				}),
				interaction.signal ?? AbortSignal.timeout(300_000),
			),
		signal: interaction.signal ?? AbortSignal.timeout(300_000),
	});
	interaction.onProgress?.(`Listening for OAuth callback on ${REDIRECT_URI}`);
	interaction.onAuth({
		url: authorizeUrl.toString(),
		instructions: "Continue in your browser.",
	});

	try {
		const credential = await callback.wait();
		if (!credential) throw new Error("OAuth callback did not complete.");
		return credential;
	} finally {
		callback.close();
	}
}

async function requestDeviceAuthorization(gateway: string, signal: AbortSignal): Promise<DeviceAuthorizationResponse> {
	let response: Response;
	try {
		response = await fetch(new URL("/v1/oauth/device", gateway), {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE }),
			signal,
		});
	} catch (error) {
		if (signal.aborted) {
			throw new Error("Login cancelled");
		}
		throw error;
	}

	if (!response.ok) {
		throw await readOAuthResponseError(response, "Radius OAuth device authorization failed");
	}

	const data = (await response.json()) as Partial<DeviceAuthorizationResponse>;
	if (!data.device_code || !data.user_code || !data.verification_uri || !data.expires_in) {
		throw new Error("Radius OAuth device authorization response is missing required fields");
	}

	return {
		device_code: data.device_code,
		user_code: data.user_code,
		verification_uri: data.verification_uri,
		expires_in: data.expires_in,
		interval: data.interval,
	};
}

async function loginWithDeviceCode(gateway: string, interaction: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const device = await requestDeviceAuthorization(gateway, interaction.signal ?? AbortSignal.timeout(300_000));
	interaction.onAuth({
		url: device.verification_uri,
		kind: "device",
		userCode: device.user_code,
		expiresInSeconds: device.expires_in,
	});

	return pollOAuthDeviceCodeFlow<OAuthCredentials>({
		intervalSeconds: device.interval,
		expiresInSeconds: device.expires_in,
		signal: interaction.signal ?? AbortSignal.timeout(300_000),
		poll: async () => {
			try {
				const credentials = await requestOAuthToken(
					gateway,
					new URLSearchParams({
						grant_type: OAUTH_DEVICE_CODE_GRANT_TYPE,
						client_id: OAUTH_CLIENT_ID,
						device_code: device.device_code,
					}),
					interaction.signal ?? AbortSignal.timeout(300_000),
				);
				return { status: "complete", value: credentials };
			} catch (error) {
				if (!(error instanceof OAuthResponseError)) {
					throw error;
				}
				switch (error.oauthError) {
					case "authorization_pending":
						return { status: "pending" };
					case "slow_down":
						return { status: "slow_down" };
					case "expired_token":
						return { status: "failed", message: "Device authorization expired." };
					case "access_denied":
						return { status: "failed", message: "Device authorization was denied." };
					default:
						throw error;
				}
			}
		},
	});
}

export interface RadiusOAuthOptions {
	name: string;
	gateway: string;
}

export function createRadiusOAuth(options: RadiusOAuthOptions): OAuthProviderInterface {
	const gateway = normalizeRadiusGatewayUrl(options.gateway);
	return {
		id: "radius",
		name: options.name,
		login: async interaction => {
			const signal = interaction.signal ?? AbortSignal.timeout(300_000);
			signal.throwIfAborted();
			if (interaction.method === "device") return loginWithDeviceCode(gateway, interaction);
			const discovery = await loadRadiusOAuthDiscovery(gateway, signal);
			return loginWithBrowser(gateway, discovery.authorizationEndpoint, interaction);
		},
		refreshToken: (credential, signal) =>
			requestOAuthToken(
				gateway,
				new URLSearchParams({
					grant_type: "refresh_token",
					client_id: OAUTH_CLIENT_ID,
					refresh_token: credential.refresh,
				}),
				signal,
			),
		getApiKey: credential => credential.access,
	};
}
