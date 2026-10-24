import { createHash } from "node:crypto";
import type { Model } from "../types";
import { type KiroCredentials, validKiroRegion } from "../utils/oauth/kiro-credentials";

export interface KiroServiceOptions {
	fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	signal?: AbortSignal;
	regions?: string[];
}
export interface KiroProfile {
	arn: string;
	name: string;
	region: string;
}
export function kiroEndpoint(region: string): string {
	if (!validKiroRegion(region)) throw new Error("Invalid Kiro service region");
	return `https://q.${region}.amazonaws.com`;
}
export function kiroCacheNamespace(c: KiroCredentials): string {
	if (!c.accountId || !c.profileArn || !c.serviceRegion)
		throw new Error("Kiro account/profile selection required. Run /login kiro.");
	return `kiro:${createHash("sha256")
		.update(JSON.stringify([c.accountId, c.profileArn, c.serviceRegion]))
		.digest("hex")}`;
}
export async function kiroRequest(url: string, init: RequestInit, options: KiroServiceOptions = {}): Promise<Response> {
	const signal = options.signal
		? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
		: AbortSignal.timeout(30000);
	signal.throwIfAborted();
	return (options.fetch ?? globalThis.fetch)(url, { ...init, signal });
}
function headers(c: KiroCredentials): Record<string, string> {
	return { Authorization: `Bearer ${c.access}`, "Content-Type": "application/json", "User-Agent": "xcsh-kiro" };
}
async function jsonResponse(response: Response): Promise<Record<string, any>> {
	if (!response.ok)
		throw new Error(
			`Kiro service HTTP ${response.status}${response.status === 401 || response.status === 403 ? ". Reconnect with /login kiro." : ". Retry when the service is available."}`,
		);
	const body = await response.json();
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Malformed Kiro response");
	return body;
}
async function pages<T>(
	request: (token?: string) => Promise<Record<string, any>>,
	field: string,
): Promise<{ items: T[]; defaultModel?: unknown }> {
	const items: T[] = [];
	const seen = new Set<string>();
	let token: string | undefined;
	let defaultModel: unknown;
	for (let page = 0; page < 100; page++) {
		const body = await request(token);
		if (!Array.isArray(body[field])) throw new Error(`Malformed Kiro ${field} response`);
		items.push(...body[field]);
		defaultModel = body.defaultModel ?? defaultModel;
		if (!body.nextToken) return { items, defaultModel };
		if (typeof body.nextToken !== "string" || seen.has(body.nextToken)) throw new Error("Invalid Kiro pagination");
		token = body.nextToken;
		seen.add(token);
	}
	throw new Error("Kiro pagination exceeded limit");
}
export async function discoverKiroProfiles(
	c: KiroCredentials,
	options: KiroServiceOptions = {},
): Promise<KiroProfile[]> {
	const profiles = new Map<string, KiroProfile>();
	// Desktop 1.4.26 maps BuilderId to this service-owned profile; the API
	// explicitly rejects ListAvailableProfiles for Builder ID.
	if (c.authMethod === "builder-id")
		return [
			{
				arn: "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
				name: "AWS Builder ID",
				region: "us-east-1",
			},
		];
	const regions = options.regions ?? ["us-east-1", "eu-central-1"];
	for (const region of regions) {
		const result = await pages<{ arn: string; name?: string }>(
			async nextToken =>
				jsonResponse(
					await kiroRequest(
						`${kiroEndpoint(region)}/ListAvailableProfiles`,
						{
							method: "POST",
							headers: headers(c),
							body: JSON.stringify({ ...(nextToken ? { nextToken } : {}) }),
						},
						options,
					),
				),
			"profiles",
		);
		for (const p of result.items) {
			if (typeof p.arn !== "string") throw new Error("Malformed Kiro profile");
			const serviceRegion = p.arn.split(":")[3];
			if (!serviceRegion || !validKiroRegion(serviceRegion)) throw new Error("Invalid Kiro profile region");
			profiles.set(p.arn, { arn: p.arn, name: p.name ?? "Kiro profile", region: serviceRegion });
		}
	}
	if (!profiles.size)
		throw new Error("No Kiro profiles available for this account. Check entitlement or choose another account.");
	return [...profiles.values()];
}
export async function discoverKiroModels(
	c: KiroCredentials,
	options: KiroServiceOptions = {},
): Promise<{ models: Model<"kiro-api">[]; defaultModel?: string }> {
	if (!c.profileArn || !c.serviceRegion) throw new Error("Select a Kiro profile with /login kiro");
	const result = await pages<Record<string, any>>(async nextToken => {
		const url = new URL(`${kiroEndpoint(c.serviceRegion!)}/ListAvailableModels`);
		url.searchParams.set("origin", "KIRO_CLI");
		url.searchParams.set("profileArn", c.profileArn!);
		if (nextToken) url.searchParams.set("nextToken", nextToken);
		return jsonResponse(await kiroRequest(url.toString(), { headers: headers(c) }, options));
	}, "models");
	const models = result.items.map(m => {
		const input = m.tokenLimits?.maxInputTokens;
		const output = m.tokenLimits?.maxOutputTokens;
		if (
			typeof m.modelId !== "string" ||
			!m.modelId ||
			!Number.isFinite(input) ||
			input <= 0 ||
			!Number.isFinite(output) ||
			output <= 0
		)
			throw new Error("Kiro model is missing service limits or ID");
		const model: Model<"kiro-api"> = {
			id: m.modelId,
			name: m.modelName ?? m.modelId,
			provider: "kiro",
			kiroConnection: { accountId: c.accountId!, profileArn: c.profileArn!, serviceRegion: c.serviceRegion! },
			api: "kiro-api",
			baseUrl: `${kiroEndpoint(c.serviceRegion!)}/generateAssistantResponse`,
			reasoning: false,
			input: m.supportedInputTypes?.includes("IMAGE") ? ["text", "image"] : ["text"],
			contextWindow: input,
			maxTokens: output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, pricingKnown: false },
		};
		return model;
	});
	if (!models.length) throw new Error("No Kiro models available for the selected profile");
	const d = result.defaultModel;
	const defaultModel =
		typeof d === "string" ? d : d && typeof d === "object" ? (d as { modelId?: string }).modelId : undefined;
	for (const model of models) model.providerDefault = model.id === defaultModel;
	return { models, defaultModel: models.some(m => m.id === defaultModel) ? defaultModel : undefined };
}
