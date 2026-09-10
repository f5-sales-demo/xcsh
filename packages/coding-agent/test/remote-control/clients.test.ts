import { expect, test } from "bun:test";
import { listRemoteClients, revokeRemoteClient } from "../../src/remote-control/clients";

const auth = { accessToken: "fixture-token", accountId: "example-account" };
test("native client listing uses selected subscription and pinned pagination and response fields", async () => {
	const result = await listRemoteClients(
		"example-env /?",
		{ cursor: "next /?", limit: 20, order: "desc" },
		{
			authenticate: async () => auth,
			send: async request => {
				const url = new URL(request.url);
				expect(url.pathname).toBe("/backend-api/wham/remote/control/environments/example-env%20%2F%3F/clients");
				expect(url.searchParams.get("cursor")).toBe("next /?");
				expect(url.searchParams.get("limit")).toBe("20");
				expect(url.searchParams.get("order")).toBe("desc");
				expect(request.headers.get("authorization")).toBe("Bearer fixture-token");
				expect(request.headers.get("chatgpt-account-id")).toBe("example-account");
				expect(request.headers.get("originator")).toBe("xcsh");
				expect(request.redirect).toBe("error");
				return Response.json({
					items: [
						{
							client_id: "example-client",
							display_name: "Example Phone",
							device_type: "phone",
							platform: "ios",
							last_seen_at: "2026-01-01T00:00:00Z",
						},
					],
					cursor: "page-two",
				});
			},
		},
	);
	expect(result).toEqual({
		data: [
			{
				clientId: "example-client",
				displayName: "Example Phone",
				deviceType: "phone",
				platform: "ios",
				osVersion: null,
				deviceModel: null,
				appVersion: null,
				lastSeenAt: 1767225600,
			},
		],
		nextCursor: "page-two",
	});
});
test("client revocation uses the pinned DELETE route and accepts an empty success", async () => {
	await expect(
		revokeRemoteClient("example-env", "example-client /?", {
			authenticate: async () => auth,
			send: async request => {
				expect(request.method).toBe("DELETE");
				expect(request.url).toEndWith("/example-env/clients/example-client%20%2F%3F");
				return new Response(null, { status: 204 });
			},
		}),
	).resolves.toEqual({});
});
test("client management recovers unauthorized authentication once without switching accounts", async () => {
	let requests = 0,
		recoveries = 0;
	const deps = {
		authenticate: async (previous?: typeof auth) => {
			if (previous) {
				expect(previous).toEqual(auth);
				recoveries++;
			}
			return { ...auth, accessToken: previous ? "fixture-refreshed" : auth.accessToken };
		},
		send: async (request: Request) => {
			if (++requests === 1) return new Response("private fixture body", { status: 401 });
			expect(request.headers.get("authorization")).toBe("Bearer fixture-refreshed");
			return Response.json({ items: [] });
		},
	};
	expect(await listRemoteClients("example-env", {}, deps)).toEqual({ data: [], nextCursor: null });
	expect(recoveries).toBe(1);
});
test.each([401, 403, 429, 500])("client errors remain bounded and sanitized for HTTP %s", async status => {
	let calls = 0;
	await expect(
		revokeRemoteClient("example-env", "example-client", {
			authenticate: async () => auth,
			send: async () => {
				calls++;
				return new Response("private fixture-token", { status });
			},
		}),
	).rejects.toThrow(`Remote client management rejected: HTTP ${status}`);
	expect(calls).toBe(status === 401 ? 2 : 1);
});
test("client management rejects malformed and oversized responses", async () => {
	for (const body of [
		{},
		{ items: [{}] },
		{ items: [{ client_id: "example-client", last_seen_at: "invalid" }] },
		{ items: [], cursor: 5 },
		{ items: [], padding: "x".repeat(1_100_000) },
	]) {
		await expect(
			listRemoteClients(
				"example-env",
				{},
				{ authenticate: async () => auth, send: async () => Response.json(body) },
			),
		).rejects.toThrow("Invalid remote client response");
	}
});
test("invalid client-management arguments fail before authentication or requests", async () => {
	const deps = {
		authenticate: async () => {
			throw new Error("unexpected authentication");
		},
	};
	for (const limit of [0, 101, 1.5])
		await expect(listRemoteClients("example-env", { limit }, deps)).rejects.toThrow("limit");
	for (const id of ["", ".", "..", "\n"])
		await expect(revokeRemoteClient("example-env", id, deps)).rejects.toThrow("identity");
});
