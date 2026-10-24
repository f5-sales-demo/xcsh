import { describe, expect, it } from "bun:test";
import { createKiroOAuth, normalizeKiroCredentials } from "../src/utils/oauth/kiro";

function fixture(errors: string[] = []) {
	let time = 0;
	const delays: number[] = [];
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const oauth = createKiroOAuth({
		now: () => time,
		sleep: async (ms, signal) => {
			signal?.throwIfAborted();
			delays.push(ms);
			time += ms;
		},
		readSources: async () => [],
		fetch: async (url, init) => {
			init?.signal?.throwIfAborted();
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			if (String(url).endsWith("/client/register"))
				return Response.json({ clientId: "client", clientSecret: "secret", clientSecretExpiresAt: 10000 });
			if (String(url).endsWith("/device_authorization"))
				return Response.json({
					deviceCode: "device",
					userCode: "FAKE",
					verificationUri: "https://example.com",
					expiresIn: 30,
					interval: 1,
				});
			const error = errors.shift();
			return error
				? Response.json({ error }, { status: error === "transient" ? 503 : 400 })
				: Response.json({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600 });
		},
		discoverProfiles: async () => [
			{ arn: "arn:aws:codewhisperer:us-east-1:123:profile/test", name: "Test", region: "us-east-1" },
		],
		discoverModels: async () => [{ id: "auto" }],
	});
	return { oauth, calls, delays };
}
describe("Kiro OIDC", () => {
	for (const method of ["AWS Builder ID", "Company SSO"]) {
		it(`authorizes ${method} and retains issuer and registration metadata`, async () => {
			const { oauth, calls, delays } = fixture(["authorization_pending", "slow_down", "transient"]);
			const answers = [method, "https://company.awsapps.com/start", "eu-west-1"];
			const credential = await oauth.login({ onPrompt: async () => answers.shift()!, onAuth() {} });
			expect(credential.authMethod).toBe(method === "Company SSO" ? "idc" : "builder-id");
			expect(credential.region).toBe(method === "Company SSO" ? "eu-west-1" : "us-east-1");
			expect(credential.registrationExpires).toBe(10000000);
			expect(credential.profileArn).toContain("profile/test");
			expect(delays.slice(0, 3)).toEqual([1000, 1000, 6000]);
			expect(calls[0].body.grantTypes).toContain("refresh_token");
		});
	}
	for (const error of ["access_denied", "expired_token", "invalid_client", "invalid_grant"]) {
		it(`fails ${error} without saving partial login`, async () => {
			await expect(
				fixture([error]).oauth.login({ onPrompt: async () => "AWS Builder ID", onAuth() {} }),
			).rejects.toThrow();
		});
	}
	it("cancels before network and expires pending device flow", async () => {
		const f = fixture();
		await expect(
			f.oauth.login({ signal: AbortSignal.abort(), onPrompt: async () => "", onAuth() {} }),
		).rejects.toThrow();
		expect(f.calls).toHaveLength(0);
		await expect(
			fixture(Array(50).fill("authorization_pending")).oauth.login({
				onPrompt: async () => "AWS Builder ID",
				onAuth() {},
			}),
		).rejects.toThrow("expired");
	});
	it("refreshes with exact issuer and preserves profile", async () => {
		const f = fixture();
		const c = normalizeKiroCredentials({
			accessToken: "old",
			refreshToken: "refresh",
			clientId: "client",
			clientSecret: "secret",
			region: "eu-west-1",
			startUrl: "https://company.awsapps.com/start",
			expiresAt: "2030-01-01T00:00:00Z",
			registrationExpiresAt: "2031-01-01T00:00:00Z",
		});
		const next = await f.oauth.refreshToken(c!, new AbortController().signal);
		expect(next.access).toBe("access");
		expect(f.calls[0].url).toBe("https://oidc.eu-west-1.amazonaws.com/token");
		expect(f.calls[0].body.grantType).toBe("refresh_token");
	});
	it("rejects social, incomplete, expired registration and mismatched regions", () => {
		expect(normalizeKiroCredentials({ authMethod: "social", accessToken: "x" })).toBeNull();
		expect(normalizeKiroCredentials({ accessToken: "x", refreshToken: "y", region: "us-east-1" })).toBeNull();
		expect(
			normalizeKiroCredentials(
				{
					access_token: "x",
					refresh_token: "y",
					region: "us-east-1",
					start_url: "https://view.awsapps.com/start",
					expires_at: "2030-01-01",
					oauth_flow: "DeviceCode",
				},
				{ client_id: "c", client_secret: "s", region: "eu-west-1", client_secret_expires_at: 9999999999 },
			),
		).toBeNull();
	});
});
it("rejects Desktop metadata with empty secrets even when company URL is missing", () => {
	expect(
		normalizeKiroCredentials(
			{
				authMethod: "IdC",
				provider: "Enterprise",
				startUrl: "",
				startUrlHash: "a".repeat(40),
				region: "us-east-1",
				accessToken: "",
				refreshToken: "",
				expiresAt: "2030-01-01",
			},
			{ clientId: "", clientSecret: "", client_secret_expires_at: 2200000000 },
		),
	).toBeNull();
});
it("requires a profile choice and leaves stored authentication intact when discovery fails", async () => {
	const f = fixture();
	const { oauth } = fixture();
	const profiles = [
		{ arn: "arn:aws:codewhisperer:us-east-1:123:profile/one", name: "One", region: "us-east-1" },
		{ arn: "arn:aws:codewhisperer:eu-central-1:123:profile/two", name: "Two", region: "eu-central-1" },
	];
	const c = normalizeKiroCredentials({
		accessToken: "old",
		refreshToken: "refresh",
		clientId: "c",
		clientSecret: "s",
		region: "us-east-1",
		startUrl: "https://view.awsapps.com/start",
		expiresAt: "2030-01-01",
		registrationExpiresAt: "2031-01-01",
	})!;
	const provider = createKiroOAuth({
		readSources: async () => [{ kind: "desktop", path: "fake", credentials: c }],
		discoverProfiles: async () => profiles,
		discoverModels: async () => [{ id: "auto" }],
	});
	const answers = ["1", "2"];
	const selected = await provider.login({ onPrompt: async () => answers.shift()!, onAuth() {} });
	expect(selected.profileArn).toBe(profiles[1].arn);
	expect(selected.serviceRegion).toBe("eu-central-1");
	await expect(
		provider.login({
			onPrompt: async () => {
				throw new Error("cancelled");
			},
			onAuth() {},
		}),
	).rejects.toThrow("cancelled");
	expect(c.access).toBe("old");
	void f;
	void oauth;
});
it("rereads newer imported credentials without accepting a changed native login session", async () => {
	const base = {
		access: "old",
		refresh: "same-session",
		expires: 0,
		clientId: "c",
		clientSecret: "s",
		registrationExpires: Date.now() + 86400000,
		authMethod: "idc" as const,
		region: "us-east-1",
		startUrl: "https://company.awsapps.com/start",
		accountId: "account",
		profileArn: "profile",
		serviceRegion: "us-east-1",
		source: { kind: "desktop" as const, path: "fake" },
	};
	let requests = 0;
	const newer = { ...base, access: "new", expires: Date.now() + 3600000 };
	const provider = createKiroOAuth({
		readSources: async () => [{ kind: "desktop", path: "fake", credentials: newer }],
		fetch: async () => {
			requests++;
			return Response.json({ error: "invalid_grant" }, { status: 400 });
		},
	});
	expect((await provider.refreshToken(base, new AbortController().signal)).access).toBe("new");
	expect(requests).toBe(0);
	newer.refresh = "another-session";
	await expect(provider.refreshToken(base, new AbortController().signal)).rejects.toThrow("fresh login");
	expect(requests).toBe(1);
});
it("does not activate tokens returned after the device authorization deadline", async () => {
	let now = 0;
	let selected = false;
	const provider = createKiroOAuth({
		now: () => now,
		readSources: async () => [],
		sleep: async ms => {
			now += ms;
		},
		fetch: async url => {
			if (String(url).endsWith("/client/register"))
				return Response.json({ clientId: "fake", clientSecret: "fake", clientSecretExpiresAt: 20000 });
			if (String(url).endsWith("/device_authorization"))
				return Response.json({
					deviceCode: "fake",
					userCode: "FAKE",
					verificationUri: "https://example.invalid",
					expiresIn: 2,
					interval: 1,
				});
			now = 3000;
			return Response.json({ accessToken: "late", refreshToken: "fake", expiresIn: 3600 });
		},
		discoverProfiles: async () => {
			selected = true;
			return [{ arn: "arn:aws:codewhisperer:us-east-1:123:profile/fake", name: "Fake", region: "us-east-1" }];
		},
		discoverModels: async () => [{ id: "auto" }],
	});
	await expect(provider.login({ onPrompt: async () => "AWS Builder ID", onAuth() {} })).rejects.toThrow("expired");
	expect(selected).toBe(false);
});
it("asks fresh Company SSO details explicitly without borrowing another detected account", async () => {
	const c = normalizeKiroCredentials({
		accessToken: "fake",
		refreshToken: "fake",
		clientId: "fake",
		clientSecret: "fake",
		region: "us-east-1",
		startUrl: "https://detected.awsapps.com/start",
		expiresAt: "2030-01-01",
		registrationExpiresAt: "2031-01-01",
	})!;
	let time = 0;
	const prompts: { message: string; allowEmpty?: boolean; placeholder?: string }[] = [];
	const answers = ["Company SSO", "https://selected.awsapps.com/start", "eu-west-1"];
	const provider = createKiroOAuth({
		readSources: async () => [{ kind: "desktop", path: "fake", credentials: c }],
		now: () => time,
		sleep: async ms => {
			time += ms;
		},
		fetch: async url => {
			if (String(url).endsWith("/client/register"))
				return Response.json({ clientId: "fake", clientSecret: "fake", clientSecretExpiresAt: 99999999 });
			if (String(url).endsWith("/device_authorization"))
				return Response.json({
					deviceCode: "fake",
					userCode: "FAKE",
					verificationUri: "https://example.invalid",
					expiresIn: 60,
					interval: 1,
				});
			return Response.json({ accessToken: "fake", refreshToken: "fake", expiresIn: 3600 });
		},
		discoverProfiles: async () => [
			{ arn: "arn:aws:codewhisperer:us-east-1:123:profile/fake", name: "Fake", region: "us-east-1" },
		],
		discoverModels: async () => [{ id: "auto" }],
	});
	await provider.login({
		onPrompt: async p => {
			prompts.push(p);
			return answers.shift()!;
		},
		onAuth() {},
	});
	expect(prompts[1].allowEmpty).not.toBe(true);
	expect(prompts[1].placeholder).not.toBe(c.startUrl);
	expect(prompts[2].allowEmpty).not.toBe(true);
});
it("does not combine native login grants that reuse one client registration", () => {
	const common = {
		accessToken: "fake",
		refreshToken: "account-one-grant",
		clientId: "shared-registration",
		clientSecret: "fake",
		region: "us-east-1",
		startUrl: "https://view.awsapps.com/start",
		expiresAt: "2030-01-01",
		registrationExpiresAt: "2031-01-01",
	};
	const first = normalizeKiroCredentials(common)!;
	const second = normalizeKiroCredentials({ ...common, refreshToken: "account-two-grant" })!;
	expect(first.accountId).not.toBe(second.accountId);
});
