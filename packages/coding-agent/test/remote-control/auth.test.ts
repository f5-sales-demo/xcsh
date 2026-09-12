import { expect, test } from "bun:test";
import { loadRemoteSubscription } from "../../src/remote-control/auth";

const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "example-selected-account" } })).toString("base64url")}.fixture`;
test("uses refreshed selected token and derives its matching account", async () => {
	let selectedSession: string | undefined;
	const result = await loadRemoteSubscription(
		{
			getCredentialSource: () => "stored-oauth",
			getApiKey: async (_provider, session) => {
				selectedSession = session;
				return token;
			},
		},
		"remote-host",
	);
	expect(selectedSession).toBe("remote-host");
	expect(result).toEqual({ accessToken: token, accountId: "example-selected-account" });
});
test.each(["stored-api-key", "environment", "configuration", "runtime", undefined])(
	"rejects non-subscription source %s",
	async source => {
		let called = false;
		await expect(
			loadRemoteSubscription(
				{
					getCredentialSource: () => source,
					getApiKey: async () => {
						called = true;
						return token;
					},
				},
				"remote-host",
			),
		).rejects.toThrow("ChatGPT subscription");
		expect(called).toBe(false);
	},
);
test("does not expose credential refresh errors", async () => {
	await expect(
		loadRemoteSubscription(
			{
				getCredentialSource: () => "stored-oauth",
				getApiKey: async () => {
					throw new Error(token);
				},
			},
			"remote-host",
		),
	).rejects.toThrow("ChatGPT subscription credential unavailable");
});
test.each([undefined, "fixture-invalid-token"])("rejects missing account claims", async value => {
	await expect(
		loadRemoteSubscription(
			{ getCredentialSource: () => "stored-oauth", getApiKey: async () => value },
			"remote-host",
		),
	).rejects.toThrow("ChatGPT subscription account unavailable");
});

test("remote unauthorized recovery refreshes the observed selected credential row only", async () => {
	const { recoverRemoteSubscription } = await import("../../src/remote-control/auth");
	let current = token;
	const refreshed = `refreshed.${token.split(".")[1]}.fixture`;
	const selected = { type: "oauth", access: token, refresh: "fixture-refresh", expires: 0 };
	const result = await recoverRemoteSubscription(
		{
			getCredentialSource: () => "stored-oauth",
			getApiKey: async () => current,
			reload: async () => {},
			listStoredCredentials: () => [
				{ id: 1, credential: { ...selected, access: "other-fixture" } },
				{ id: 2, credential: selected },
			],
			refreshStoredOAuthCredential: async (_provider: string, options: any) => {
				expect(options.credentialId).toBe(2);
				expect(options.forceRefresh).toBe(true);
				current = refreshed;
				return { credential: { ...selected, access: refreshed } };
			},
		} as any,
		"remote-fixture",
		{ accessToken: token, accountId: "example-selected-account" },
	);
	expect(result).toEqual({ accessToken: refreshed, accountId: "example-selected-account" });
});
test("remote unauthorized recovery adopts a concurrently refreshed token without touching other accounts", async () => {
	const { recoverRemoteSubscription } = await import("../../src/remote-control/auth");
	const refreshed = `refreshed.${token.split(".")[1]}.fixture`;
	const result = await recoverRemoteSubscription(
		{
			getCredentialSource: () => "stored-oauth",
			getApiKey: async () => refreshed,
			reload: async () => {},
			listStoredCredentials: () => [],
			refreshStoredOAuthCredential: async () => {
				throw new Error("unexpected refresh");
			},
		} as any,
		"remote-fixture",
		{ accessToken: token, accountId: "example-selected-account" },
	);
	expect(result.accessToken).toBe(refreshed);
});
test("remote unauthorized recovery refuses account changes and sanitizes refresh failures", async () => {
	const { recoverRemoteSubscription } = await import("../../src/remote-control/auth");
	const storage = {
		getCredentialSource: () => "stored-oauth",
		getApiKey: async () => token,
		reload: async () => {},
		listStoredCredentials: () => [],
	};
	await expect(
		recoverRemoteSubscription(storage as any, "remote-fixture", {
			accessToken: "stale-fixture",
			accountId: "example-other-account",
		}),
	).rejects.toThrow("subscription recovery unavailable");
	await expect(
		recoverRemoteSubscription(
			{
				...storage,
				reload: async () => {
					throw new Error("private-fixture");
				},
			} as any,
			"remote-fixture",
			{ accessToken: "stale-fixture", accountId: "example-selected-account" },
		),
	).rejects.toThrow("subscription recovery unavailable");
});
