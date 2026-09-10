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
