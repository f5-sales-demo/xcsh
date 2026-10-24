import { createHash } from "node:crypto";
import type { OAuthCredentials } from "./types";

export const BUILDER_ID_START_URL = "https://view.awsapps.com/start";
export const BUILDER_ID_REGION = "us-east-1";
export interface KiroCredentials extends OAuthCredentials {
	authMethod: "builder-id" | "idc";
	region: string;
	serviceRegion?: string;
	startUrl: string;
	/** Native Desktop hash retained until a missing company start URL is supplied. */
	startUrlHash?: string;
	clientId: string;
	clientSecret: string;
	registrationExpires: number;
	selectedAt?: number;
	profileArn?: string;
	profileName?: string;
	defaultModel?: string;
	source?: { kind: "cli" | "desktop"; path: string };
}
export function kiroAccountId(clientId: string, startUrl: string, refreshGrant: string): string {
	return createHash("sha256")
		.update(JSON.stringify([clientId, startUrl, refreshGrant]))
		.digest("hex");
}
export function validKiroRegion(region: string): boolean {
	return /^(us|eu|ap|ca|sa|me|af|il|mx)-(?:gov-)?[a-z]+-\d$/.test(region);
}
function expiry(value: unknown): number {
	if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
	return typeof value === "string" ? Date.parse(value) : NaN;
}
/** A token and its registration must be from the same explicit native source. */
export function normalizeKiroCredentials(value: unknown, registration?: unknown): KiroCredentials | null {
	if (!value || typeof value !== "object") return null;
	const t = value as Record<string, unknown>;
	const r = (registration ?? t) as Record<string, unknown>;
	if (!r || typeof r !== "object" || t.authMethod === "social" || t.provider === "Google" || t.provider === "Github")
		return null;
	const access = t.access ?? t.accessToken ?? t.access_token;
	const refresh = t.refresh ?? t.refreshToken ?? t.refresh_token;
	const clientId = r.clientId ?? r.client_id;
	const clientSecret = r.clientSecret ?? r.client_secret;
	const region = t.region;
	const startUrl = t.startUrl ?? t.start_url;
	const expires = expiry(t.expires ?? t.expiresAt ?? t.expires_at);
	const registrationExpires = expiry(r.registrationExpires ?? r.registrationExpiresAt ?? r.client_secret_expires_at);
	if (![access, refresh, clientId, clientSecret, region].every(v => typeof v === "string" && v.length > 0))
		return null;
	if (
		typeof startUrl !== "string" ||
		(!startUrl && !(t.authMethod === "IdC" && t.provider === "Enterprise" && typeof t.startUrlHash === "string"))
	)
		return null;
	if (r.region && r.region !== region) return null;
	if (
		!validKiroRegion(region as string) ||
		!Number.isFinite(expires) ||
		!Number.isFinite(registrationExpires) ||
		registrationExpires <= Date.now()
	)
		return null;
	const missingCompanyUrl =
		startUrl === "" && t.authMethod === "IdC" && t.provider === "Enterprise" && typeof t.startUrlHash === "string";
	let url: URL;
	try {
		url = new URL(missingCompanyUrl ? "https://company.awsapps.com/start" : (startUrl as string));
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
	const method = startUrl === BUILDER_ID_START_URL ? "builder-id" : "idc";
	if (
		(t.authMethod === "builder-id" && method !== "builder-id") ||
		(method === "builder-id" && region !== BUILDER_ID_REGION)
	)
		return null;
	return {
		access: access as string,
		refresh: refresh as string,
		clientId: clientId as string,
		clientSecret: clientSecret as string,
		region: region as string,
		startUrl: startUrl as string,
		expires,
		registrationExpires,
		authMethod: method,
		accountId: kiroAccountId(clientId as string, (t.startUrlHash ?? startUrl) as string, refresh as string),
		...(typeof t.startUrlHash === "string" ? { startUrlHash: t.startUrlHash } : {}),
		...(typeof t.profileArn === "string" ? { profileArn: t.profileArn } : {}),
		...(typeof t.profileName === "string" ? { profileName: t.profileName } : {}),
		...(typeof t.serviceRegion === "string" ? { serviceRegion: t.serviceRegion } : {}),
		...(typeof t.defaultModel === "string" ? { defaultModel: t.defaultModel } : {}),
	};
}
