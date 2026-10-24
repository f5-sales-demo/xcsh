import { expect, it } from "bun:test";
import { discoverKiroModels, discoverKiroProfiles, kiroCacheNamespace } from "../src/providers/kiro-service";
import type { KiroCredentials } from "../src/utils/oauth/kiro-credentials";

const c: KiroCredentials = {
	access: "fake",
	refresh: "fake",
	expires: 9999999999999,
	clientId: "fake",
	clientSecret: "fake",
	registrationExpires: 9999999999999,
	authMethod: "idc",
	region: "eu-west-1",
	serviceRegion: "us-east-1",
	startUrl: "https://company.awsapps.com/start",
	accountId: "<account-id>",
	profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/one",
};
it("paginates native profiles/models and retains exact IDs, limits and default", async () => {
	const urls: string[] = [];
	const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
		const u = String(url);
		urls.push(u);
		if (u.endsWith("/ListAvailableProfiles")) {
			const b = JSON.parse(String(init?.body));
			return Response.json({
				profiles: [
					{ arn: `arn:aws:codewhisperer:us-east-1:123:profile/${b.nextToken ? "two" : "one"}`, name: "Test" },
				],
				...(b.nextToken ? {} : { nextToken: "page2" }),
			});
		}
		const next = new URL(u).searchParams.has("nextToken");
		return Response.json({
			models: [
				{
					modelId: next ? "kiro/claude-haiku-4.5" : "auto",
					modelName: "Test",
					tokenLimits: { maxInputTokens: 200000, maxOutputTokens: 8192 },
					supportedInputTypes: ["TEXT", "IMAGE"],
				},
			],
			defaultModel: { modelId: "auto" },
			...(next ? {} : { nextToken: "next" }),
		});
	};
	expect(await discoverKiroProfiles(c, { fetch: fetcher, regions: ["us-east-1"] })).toHaveLength(2);
	const catalog = await discoverKiroModels(c, { fetch: fetcher });
	expect(catalog.defaultModel).toBe("auto");
	expect(catalog.models.map(m => m.id)).toEqual(["auto", "kiro/claude-haiku-4.5"]);
	expect(catalog.models[1].contextWindow).toBe(200000);
	expect(catalog.models[1].input).toEqual(["text", "image"]);
	expect(urls.at(-1)).toContain("profileArn=");
});
it("isolates caches by account, profile and service region", () => {
	const key = kiroCacheNamespace(c);
	for (const changed of [
		{ accountId: "<other-account-id>" },
		{ profileArn: "other" },
		{ serviceRegion: "eu-central-1" },
	])
		expect(kiroCacheNamespace({ ...c, ...changed })).not.toBe(key);
});
it("rejects empty, malformed, failed and cycling catalogs", async () => {
	for (const response of [
		Response.json({ models: [] }),
		Response.json({ bad: true }),
		Response.json({}, { status: 403 }),
	]) {
		await expect(discoverKiroModels(c, { fetch: async () => response })).rejects.toThrow();
	}
	await expect(
		discoverKiroModels(c, {
			fetch: async () =>
				Response.json({
					models: [{ modelId: "auto", tokenLimits: { maxInputTokens: 10, maxOutputTokens: 10 } }],
					nextToken: "same",
				}),
		}),
	).rejects.toThrow("pagination");
});
it("never uses another account catalog as an offline or failed-discovery fallback", async () => {
	const { createModelManager } = await import("../src/model-manager");
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = await mkdtemp(join(tmpdir(), "kiro-cache-"));
	try {
		const catalog = await discoverKiroModels(c, {
			fetch: async () =>
				Response.json({
					models: [{ modelId: "auto", tokenLimits: { maxInputTokens: 200000, maxOutputTokens: 64000 } }],
					defaultModel: { modelId: "auto" },
				}),
		});
		const base = { providerId: "kiro", staticModels: [], cacheDbPath: join(dir, "models.db") };
		const left = createModelManager({
			...base,
			cacheNamespace: kiroCacheNamespace(c),
			fetchDynamicModels: async () => catalog.models,
		});
		expect((await left.refresh("online")).models).toHaveLength(1);
		const right = createModelManager({
			...base,
			cacheNamespace: kiroCacheNamespace({ ...c, accountId: "<other-account-id>" }),
			fetchDynamicModels: async () => {
				throw new Error("offline");
			},
		});
		expect((await right.refresh("offline")).models).toEqual([]);
		expect((await right.refresh("online")).models).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
