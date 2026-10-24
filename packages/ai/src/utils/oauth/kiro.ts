/** Device authorization adapted from MIT pi-kiro 0.1.3, Copyright (c) 2026 Hongyi Lyu.
 * See providers/kiro-LICENSE for the preserved license. */
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { discoverKiroModels, discoverKiroProfiles, type KiroProfile } from "../../providers/kiro-service";
import {
	BUILDER_ID_REGION,
	BUILDER_ID_START_URL,
	type KiroCredentials,
	kiroAccountId,
	validKiroRegion,
} from "./kiro-credentials";
import { type KiroSource, readKiroSources } from "./kiro-sources";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types";

export { type KiroCredentials, normalizeKiroCredentials } from "./kiro-credentials";
export { readKiroSources } from "./kiro-sources";

const SCOPES = [
	"codewhisperer:completions",
	"codewhisperer:analysis",
	"codewhisperer:conversations",
	"codewhisperer:transformations",
	"codewhisperer:taskassist",
];
export interface KiroOAuthDependencies {
	fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	now?: () => number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	readSources?: () => Promise<KiroSource[]>;
	discoverProfiles?: (credentials: KiroCredentials, signal?: AbortSignal) => Promise<KiroProfile[]>;
	discoverModels?: (credentials: KiroCredentials, signal?: AbortSignal) => Promise<{ id: string }[]>;
}
export function createKiroOAuth(deps: KiroOAuthDependencies = {}) {
	const now = deps.now ?? Date.now;
	const sleep =
		deps.sleep ??
		(async (ms, signal) => {
			await delay(ms, undefined, { signal });
		});
	const readSources = deps.readSources ?? readKiroSources;
	async function post(region: string, path: string, body: object, signal?: AbortSignal) {
		if (!validKiroRegion(region)) throw new Error("Invalid AWS issuer region");
		const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
		bounded.throwIfAborted();
		const response = await (deps.fetch ?? globalThis.fetch)(`https://oidc.${region}.amazonaws.com${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "User-Agent": "xcsh-kiro" },
			body: JSON.stringify(body),
			signal: bounded,
		});
		if (response.status >= 500 || response.status === 429) return { error: "transient" };
		let data: Record<string, any>;
		try {
			data = (await response.json()) as Record<string, any>;
		} catch {
			throw new Error("Malformed AWS authorization response. Retry /login kiro.");
		}
		if (!data || typeof data !== "object") throw new Error("Malformed AWS authorization response");
		if (!response.ok && !data.error) throw new Error(`AWS authorization HTTP ${response.status}. Retry /login kiro.`);
		return data;
	}
	function fail(error: unknown): never {
		const known = ["access_denied", "expired_token", "invalid_client", "invalid_grant", "unauthorized_client"];
		throw new Error(
			`Kiro authorization ${known.includes(String(error)) ? error : "failed"}. ${error === "access_denied" ? "Authorization was denied." : "Choose fresh login with /login kiro."}`,
		);
	}
	async function selectProfile(c: KiroCredentials, callbacks: OAuthLoginCallbacks): Promise<KiroCredentials> {
		callbacks.onProgress?.("Discovering Kiro profiles…");
		const profiles = await (deps.discoverProfiles
			? deps.discoverProfiles(c, callbacks.signal)
			: discoverKiroProfiles(c, { signal: callbacks.signal, fetch: deps.fetch }));
		if (!profiles.length) throw new Error("No Kiro profiles available");
		let p = profiles.length === 1 ? profiles[0] : undefined;
		if (!p) {
			const selected = await callbacks.onPrompt({
				message: `Select Kiro profile:\n${profiles.map((v, i) => `${i + 1}. ${v.name} (${v.region})`).join("\n")}`,
				placeholder: "Profile number",
			});
			p = profiles[Number(selected) - 1];
			if (!p) throw new Error("Invalid Kiro profile selection");
		}
		callbacks.signal?.throwIfAborted();
		const selected = { ...c, profileArn: p.arn, profileName: p.name, serviceRegion: p.region };
		const catalog = deps.discoverModels
			? { models: await deps.discoverModels(selected, callbacks.signal), defaultModel: undefined }
			: await discoverKiroModels(selected, { signal: callbacks.signal, fetch: deps.fetch });
		if (!catalog.models.length) throw new Error("No Kiro models available");
		callbacks.signal?.throwIfAborted();
		return { ...selected, defaultModel: catalog.defaultModel };
	}
	async function refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<KiroCredentials> {
		signal.throwIfAborted();
		const c = credentials as KiroCredentials;
		const newerSource = async () => {
			if (!c.source) return null;
			const next = (await readSources()).find(
				s => s.kind === c.source!.kind && s.path === c.source!.path,
			)?.credentials;
			return next &&
				next.clientId === c.clientId &&
				next.authMethod === c.authMethod &&
				next.region === c.region &&
				(next.startUrl === c.startUrl ||
					(!!c.startUrlHash && next.startUrlHash === c.startUrlHash && !next.startUrl)) &&
				next.refresh === c.refresh &&
				next.expires > now() &&
				next.access !== c.access
				? {
						...next,
						accountId: c.accountId,
						startUrl: c.startUrl,
						selectedAt: c.selectedAt,
						profileArn: c.profileArn,
						profileName: c.profileName,
						serviceRegion: c.serviceRegion,
						defaultModel: c.defaultModel,
					}
				: null;
		};
		const newer = await newerSource();
		if (newer) return newer;
		if (
			!c.clientId ||
			!c.clientSecret ||
			!c.refresh ||
			!Number.isFinite(c.registrationExpires) ||
			c.registrationExpires <= now()
		)
			throw new Error("Kiro registration expired. Choose fresh login with /login kiro.");
		const data = await post(
			c.region,
			"/token",
			{ clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refresh, grantType: "refresh_token" },
			signal,
		);
		if (data.error) {
			const source = await newerSource();
			if (source) return source;
			fail(data.error);
		}
		if (typeof data.accessToken !== "string" || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0)
			throw new Error("Malformed Kiro refresh response");
		return {
			...c,
			access: data.accessToken,
			refresh: typeof data.refreshToken === "string" ? data.refreshToken : c.refresh,
			expires: now() + data.expiresIn * 1000 - 60000,
		};
	}
	async function login(callbacks: OAuthLoginCallbacks): Promise<KiroCredentials> {
		callbacks.signal?.throwIfAborted();
		const sources = await readSources();
		const compatible = sources
			.filter(s => s.credentials)
			.sort((a, b) => Number(b.kind === "desktop") - Number(a.kind === "desktop"));
		for (const source of sources.filter(s => !s.credentials))
			callbacks.onProgress?.(`${source.kind === "cli" ? "Kiro CLI" : "Kiro Desktop"}: ${source.reason}`);
		const choices = [
			...compatible.map(
				(s, i) =>
					`${i + 1}. Kiro ${s.kind === "cli" ? "CLI" : "Desktop"} — ${s.credentials!.authMethod === "builder-id" ? "AWS Builder ID" : "Company SSO"} (${s.credentials!.region})`,
			),
			`${compatible.length + 1}. AWS Builder ID`,
			`${compatible.length + 2}. Company SSO`,
		];
		const answer = (
			await callbacks.onPrompt({
				message: `Kiro account:\n${choices.join("\n")}`,
				placeholder: "Account number or AWS Builder ID / Company SSO",
			})
		).trim();
		callbacks.signal?.throwIfAborted();
		const index = Number(answer) - 1;
		const imported = compatible[index]?.credentials;
		if (imported) {
			if (!imported.startUrl && imported.startUrlHash) {
				const startUrl = (
					await callbacks.onPrompt({
						message: "Company start URL for this Kiro Desktop account",
						placeholder: "https://company.awsapps.com/start",
					})
				).trim();
				if (createHash("sha1").update(JSON.stringify({ startUrl })).digest("hex") !== imported.startUrlHash)
					throw new Error(
						"Company start URL does not match the selected Desktop registration. Choose fresh Company SSO login.",
					);
				imported.startUrl = startUrl;
			}
			return selectProfile(
				imported.expires <= now()
					? await refreshToken(imported, callbacks.signal ?? new AbortController().signal)
					: imported,
				callbacks,
			);
		}
		const corporate = answer === "Company SSO" || index === compatible.length + 1;
		if (!corporate && answer !== "AWS Builder ID" && index !== compatible.length)
			throw new Error("Choose an explicit Kiro account or login method");
		const startUrl = corporate
			? (
					await callbacks.onPrompt({
						message: "Company SSO start URL",
						placeholder: "https://company.awsapps.com/start",
					})
				).trim()
			: BUILDER_ID_START_URL;
		const region = corporate
			? (await callbacks.onPrompt({ message: "Company SSO issuer region", placeholder: "eu-west-1" })).trim()
			: BUILDER_ID_REGION;
		let parsed: URL;
		try {
			parsed = new URL(startUrl);
		} catch {
			throw new Error("Enter a valid HTTPS company start URL");
		}
		if (
			parsed.protocol !== "https:" ||
			parsed.username ||
			parsed.password ||
			parsed.search ||
			parsed.hash ||
			!validKiroRegion(region)
		)
			throw new Error("Enter a valid HTTPS start URL and AWS issuer region");
		const reg = await post(
			region,
			"/client/register",
			{
				clientName: "xcsh Kiro",
				clientType: "public",
				scopes: SCOPES,
				grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
			},
			callbacks.signal,
		);
		if (reg.error) fail(reg.error);
		if (!reg.clientId || !reg.clientSecret || !Number.isFinite(reg.clientSecretExpiresAt))
			throw new Error("Incomplete AWS client registration");
		const dev = await post(
			region,
			"/device_authorization",
			{ clientId: reg.clientId, clientSecret: reg.clientSecret, startUrl },
			callbacks.signal,
		);
		if (dev.error) fail(dev.error);
		if (
			!dev.deviceCode ||
			!dev.userCode ||
			!dev.verificationUri ||
			!Number.isFinite(dev.expiresIn) ||
			dev.expiresIn <= 0
		)
			throw new Error("Incomplete AWS device authorization");
		callbacks.onAuth({
			url: dev.verificationUri,
			openUrl: dev.verificationUriComplete ?? dev.verificationUri,
			kind: "device",
			userCode: dev.userCode,
			expiresInSeconds: dev.expiresIn,
			instructions: "Authorize xcsh with the selected AWS account.",
		});
		const deadline = now() + dev.expiresIn * 1000;
		let interval = Math.max(1000, (dev.interval ?? 5) * 1000);
		while (now() < deadline) {
			await sleep(Math.min(interval, deadline - now()), callbacks.signal);
			callbacks.signal?.throwIfAborted();
			if (now() >= deadline) break;
			let data: Record<string, any>;
			try {
				data = await post(
					region,
					"/token",
					{
						clientId: reg.clientId,
						clientSecret: reg.clientSecret,
						deviceCode: dev.deviceCode,
						grantType: "urn:ietf:params:oauth:grant-type:device_code",
					},
					callbacks.signal,
				);
			} catch (error) {
				callbacks.signal?.throwIfAborted();
				if (!(error instanceof TypeError) && (error as Error).name !== "TimeoutError") throw error;
				interval = Math.min(interval * 2, 15000);
				continue;
			}
			if (now() >= deadline) break;
			if (data.error === "authorization_pending") continue;
			if (data.error === "slow_down") {
				interval += 5000;
				continue;
			}
			if (data.error === "transient") {
				interval = Math.min(interval * 2, 15000);
				continue;
			}
			if (data.error) fail(data.error);
			if (!data.accessToken || !data.refreshToken || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0)
				throw new Error("Malformed Kiro token response");
			return selectProfile(
				{
					access: data.accessToken,
					refresh: data.refreshToken,
					expires: now() + data.expiresIn * 1000 - 60000,
					clientId: reg.clientId,
					clientSecret: reg.clientSecret,
					registrationExpires: reg.clientSecretExpiresAt * 1000,
					authMethod: corporate ? "idc" : "builder-id",
					region,
					startUrl,
					accountId: kiroAccountId(reg.clientId, startUrl, data.refreshToken),
				},
				callbacks,
			);
		}
		throw new Error("Kiro device authorization expired. Run /login kiro again.");
	}
	return {
		id: "kiro",
		name: "Kiro (AWS Builder ID / Company SSO)",
		login,
		refreshToken,
		getApiKey: (c: OAuthCredentials) => JSON.stringify(c),
	} satisfies OAuthProviderInterface;
}
export const kiroOAuth = createKiroOAuth();
