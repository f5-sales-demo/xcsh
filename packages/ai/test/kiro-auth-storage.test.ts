import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "../src/auth-storage";
import { getOAuthProviders, registerOAuthProvider, unregisterOAuthProviders } from "../src/utils/oauth";
import { createKiroOAuth } from "../src/utils/oauth/kiro";
import type { KiroCredentials } from "../src/utils/oauth/kiro-credentials";

it("registers Kiro as a built-in login method", () =>
	expect(getOAuthProviders().some(p => p.id === "kiro")).toBe(true));
it("coordinates Kiro refresh and preserves metadata across restart and logout", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-kiro-auth-"));
	const path = join(dir, "agent.db");
	let storage = await AuthStorage.create(path);
	let count = 0;
	const c: KiroCredentials = {
		access: "expired",
		refresh: "refresh",
		expires: 0,
		authMethod: "idc",
		region: "eu-west-1",
		serviceRegion: "us-east-1",
		startUrl: "https://company.awsapps.com/start",
		clientId: "fake",
		clientSecret: "fake",
		registrationExpires: Date.now() + 9999999,
		accountId: "fake-account",
		profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/one",
		source: { kind: "desktop", path: "fake" },
	};
	registerOAuthProvider({
		...createKiroOAuth({
			readSources: async () => [],
			fetch: async () => {
				count++;
				await Bun.sleep(10);
				return Response.json({ accessToken: "new", refreshToken: "next", expiresIn: 3600 });
			},
		}),
		sourceId: "kiro-auth-test",
	});
	try {
		await storage.set("kiro", { type: "oauth", ...c });
		const results = await Promise.all([storage.getApiKey("kiro", "one"), storage.getApiKey("kiro", "two")]);
		expect(count).toBe(1);
		expect(results.map(r => JSON.parse(r!).profileArn)).toEqual([c.profileArn, c.profileArn]);
		storage.close();
		storage = await AuthStorage.create(path);
		await storage.reload();
		expect(storage.getOAuthCredential("kiro")).toMatchObject({
			clientSecret: "fake",
			region: "eu-west-1",
			source: { kind: "desktop", path: "fake" },
			access: "new",
		});
		await storage.logout("kiro");
		expect(storage.has("kiro")).toBe(false);
	} finally {
		storage.close();
		unregisterOAuthProviders("kiro-auth-test");
		await rm(dir, { recursive: true, force: true });
	}
});
it("keeps account/profile connections separate and binds inference to its selected catalog", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kiro-bind-"));
	const storage = await AuthStorage.create(join(dir, "agent.db"));
	const old: KiroCredentials = {
		access: "old-account",
		refresh: "old-refresh",
		expires: Date.now() + 3600000,
		clientId: "old",
		clientSecret: "fake",
		registrationExpires: Date.now() + 86400000,
		authMethod: "idc",
		region: "us-east-1",
		serviceRegion: "us-east-1",
		startUrl: "https://company.awsapps.com/start",
		accountId: "old-account",
		profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/one",
	};
	const next = { ...old, access: "new-account", accountId: "new-account" };
	const profile = { ...old, access: "other-profile", profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/two" };
	try {
		await storage.set("kiro", [
			{ type: "oauth", ...old },
			{ type: "oauth", ...next },
			{ type: "oauth", ...profile },
		]);
		expect(storage.getAll().kiro).toHaveLength(3);
		expect(JSON.parse((await storage.getApiKey("kiro"))!).access).toBe("other-profile");
		const binding = { accountId: old.accountId!, profileArn: old.profileArn!, serviceRegion: old.serviceRegion! };
		expect(JSON.parse((await storage.getApiKey("kiro", "active", { kiroConnection: binding }))!).access).toBe(
			"old-account",
		);
		expect(
			await storage.getApiKey("kiro", "missing", { kiroConnection: { ...binding, accountId: "missing" } }),
		).toBeUndefined();
	} finally {
		storage.close();
		await rm(dir, { recursive: true, force: true });
	}
});
it("uses the latest explicit login even when that connection already existed", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kiro-reselect-"));
	let storage = await AuthStorage.create(join(dir, "agent.db"));
	const old: KiroCredentials = {
		access: "old",
		refresh: "fake",
		expires: Date.now() + 3600000,
		clientId: "old",
		clientSecret: "fake",
		registrationExpires: Date.now() + 86400000,
		authMethod: "builder-id",
		region: "us-east-1",
		serviceRegion: "us-east-1",
		startUrl: "https://view.awsapps.com/start",
		accountId: "old",
		profileArn: "profile",
	};
	const newer = { ...old, accountId: "new", access: "new", selectedAt: Date.now() + 1000 };
	registerOAuthProvider({
		id: "kiro",
		name: "Kiro test",
		sourceId: "kiro-reselect-test",
		login: async () => old,
		getApiKey: c => JSON.stringify(c),
	});
	try {
		await storage.set("kiro", [
			{ type: "oauth", ...old },
			{ type: "oauth", ...newer },
		]);
		await storage.login("kiro", { onPrompt: async () => "", onAuth() {} });
		expect(JSON.parse((await storage.getApiKey("kiro"))!).access).toBe("old");
		storage.close();
		storage = await AuthStorage.create(join(dir, "agent.db"));
		await storage.reload();
		expect(JSON.parse((await storage.getApiKey("kiro"))!).access).toBe("old");
	} finally {
		storage.close();
		unregisterOAuthProviders("kiro-reselect-test");
		await rm(dir, { recursive: true, force: true });
	}
});
it("never falls back to another Kiro account when the selected account loses authorization", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kiro-no-fallback-"));
	let storage = await AuthStorage.create(join(dir, "agent.db"));
	const old: KiroCredentials = {
		access: "old",
		refresh: "fake",
		expires: Date.now() + 3600000,
		clientId: "old",
		clientSecret: "fake",
		registrationExpires: Date.now() + 86400000,
		authMethod: "builder-id",
		region: "us-east-1",
		serviceRegion: "us-east-1",
		startUrl: "https://view.awsapps.com/start",
		accountId: "old",
		profileArn: "profile",
	};
	const selected = { ...old, accountId: "selected", access: "expired", expires: 0, selectedAt: Date.now() };
	registerOAuthProvider({
		...createKiroOAuth({
			readSources: async () => [],
			fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
		}),
		sourceId: "kiro-no-fallback-test",
	});
	try {
		await storage.set("kiro", [
			{ type: "oauth", ...old },
			{ type: "oauth", ...selected },
		]);
		expect(await storage.getApiKey("kiro")).toBeUndefined();
		expect(await storage.getApiKey("kiro")).toBeUndefined();
		storage.close();
		storage = await AuthStorage.create(join(dir, "agent.db"));
		await storage.reload();
		expect(await storage.getApiKey("kiro")).toBeUndefined();
		const binding = { accountId: old.accountId!, profileArn: old.profileArn!, serviceRegion: old.serviceRegion! };
		expect(JSON.parse((await storage.getApiKey("kiro", "existing", { kiroConnection: binding }))!).access).toBe(
			"old",
		);
	} finally {
		storage.close();
		unregisterOAuthProviders("kiro-no-fallback-test");
		await rm(dir, { recursive: true, force: true });
	}
});
