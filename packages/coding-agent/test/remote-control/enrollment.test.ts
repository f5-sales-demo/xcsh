import { describe, expect, test } from "bun:test";
import { enrollRemoteHost, RemoteControlError } from "../../src/remote-control/enrollment";

const identity = {
	name: "xcsh · workstation",
	version: "21.22.0",
	installationId: "fixture-installation",
	os: "linux",
	arch: "x86_64",
};
const auth = { accessToken: "fixture-subscription-token", accountId: "example-fixture-account" };
const response = {
	server_id: "fixture-server",
	environment_id: "fixture-environment",
	remote_control_token: "fixture-remote-token",
	expires_at: "2099-01-01T00:00:00Z",
};

describe("native remote enrollment", () => {
	test("sends the pinned enrollment contract with xcsh identity and selected subscription", async () => {
		let observed: Request | undefined;
		const result = await enrollRemoteHost(identity, auth, async request => {
			observed = request;
			return Response.json(response);
		});
		expect(observed?.url).toBe("https://chatgpt.com/backend-api/wham/remote/control/server/enroll");
		expect(observed?.method).toBe("POST");
		expect(observed?.headers.get("authorization")).toBe(`Bearer ${auth.accessToken}`);
		expect(observed?.headers.get("chatgpt-account-id")).toBe(auth.accountId);
		expect(observed?.headers.get("x-codex-installation-id")).toBe(identity.installationId);
		expect(observed?.headers.get("originator")).toBe("xcsh");
		expect(observed?.headers.get("user-agent")).toStartWith("xcsh/21.22.0");
		expect(observed?.redirect).toBe("error");
		expect(await observed?.json()).toEqual({
			name: identity.name,
			os: "linux",
			arch: "x86_64",
			app_server_version: "21.22.0",
			installation_id: identity.installationId,
		});
		expect(result).toEqual(response);
	});
	test.each([401, 403, 409, 429, 500])("reports HTTP %i without response body or credentials", async status => {
		try {
			await enrollRemoteHost(
				identity,
				auth,
				async () =>
					new Response(JSON.stringify({ secret: auth.accessToken, nested: response }), {
						status,
						headers: { "x-request-id": "fixture-request", "cf-mitigated": "challenge" },
					}),
			);
			throw new Error("Expected rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(RemoteControlError);
			expect(JSON.stringify(error)).not.toContain("fixture-subscription-token");
			expect(JSON.stringify(error)).not.toContain("fixture-remote-token");
			expect((error as RemoteControlError).evidence).toMatchObject({
				status,
				requestId: "fixture-request",
				challenge: true,
			});
		}
	});
	test.each([
		{},
		{ ...response, remote_control_token: "" },
		{ ...response, expires_at: "yesterday" },
		{ ...response, expires_at: "2000-01-01T00:00:00Z" },
	])("rejects malformed or expired enrollment", async body => {
		await expect(enrollRemoteHost(identity, auth, async () => Response.json(body))).rejects.toThrow(
			"Invalid enrollment response",
		);
	});
	test("does not disclose transport errors", async () => {
		await expect(
			enrollRemoteHost(identity, auth, async () => {
				throw new Error(auth.accessToken);
			}),
		).rejects.toThrow("Remote enrollment transport failed");
	});
	test("rejects missing subscription before making a request", async () => {
		let calls = 0;
		await expect(
			enrollRemoteHost(identity, { accessToken: "", accountId: "" }, async () => {
				calls++;
				return Response.json(response);
			}),
		).rejects.toThrow("ChatGPT subscription");
		expect(calls).toBe(0);
	});
});
