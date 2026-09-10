import { expect, test } from "bun:test";
import { refreshRemoteHost } from "../../src/remote-control/enrollment";

const identity = {
	name: "xcsh · fixture",
	version: "21.22.0",
	installationId: "fixture-install",
	os: "linux",
	arch: "x86_64",
};
const auth = { accessToken: "fixture-token", accountId: "example-fixture-account" };
const old = {
	server_id: "fixture-server",
	environment_id: "fixture-env",
	remote_control_token: "fixture-old",
	expires_at: "2000-01-01T00:00:00Z",
};
test("refreshes expired host credentials without reenrolling or changing host identity", async () => {
	let request: Request | undefined;
	const next = { ...old, remote_control_token: "fixture-new", expires_at: "2099-01-01T00:00:00Z" };
	expect(
		await refreshRemoteHost(identity, auth, old, async value => {
			request = value;
			return Response.json(next);
		}),
	).toEqual(next);
	expect(request?.url).toEndWith("/server/refresh");
	expect(await request?.json()).toEqual({ server_id: old.server_id, installation_id: identity.installationId });
});
test("rejects a refreshed credential for another host", async () => {
	await expect(
		refreshRemoteHost(identity, auth, old, async () =>
			Response.json({ ...old, server_id: "other", expires_at: "2099-01-01T00:00:00Z" }),
		),
	).rejects.toThrow("Mismatched host refresh");
});
