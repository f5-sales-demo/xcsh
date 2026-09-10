import { expect, test } from "bun:test";
import { startPairing } from "../../src/remote-control/pairing";

const enrollment = {
	server_id: "fixture-server",
	environment_id: "fixture-environment",
	remote_control_token: "fixture-secret",
	expires_at: "2099-01-01T00:00:00Z",
};
test("pairing uses host credential and requests a manual code", async () => {
	let observed: Request | undefined;
	const response = {
		pairing_code: "fixture-pair-code",
		manual_pairing_code: "ABCD-EFGH",
		server_id: enrollment.server_id,
		environment_id: enrollment.environment_id,
		expires_at: enrollment.expires_at,
	};
	expect(
		await startPairing(enrollment, async request => {
			observed = request;
			return Response.json(response);
		}),
	).toEqual(response);
	expect(observed?.url).toBe("https://chatgpt.com/backend-api/wham/remote/control/server/pair");
	expect(observed?.headers.get("authorization")).toBe("Bearer fixture-secret");
	expect(await observed?.json()).toEqual({ manual_code: true });
});
test.each(["server_id", "environment_id"])("rejects mismatched %s", async field => {
	await expect(
		startPairing(enrollment, async () => Response.json({ ...enrollment, pairing_code: "fixture", [field]: "other" })),
	).rejects.toThrow("Invalid pairing response");
});
test("rejects expired host without a network call", async () => {
	await expect(
		startPairing({ ...enrollment, expires_at: "2000-01-01T00:00:00Z" }, async () => {
			throw new Error("Must not call");
		}),
	).rejects.toThrow("Host credential expired");
});
test("rejects service error without leaking pairing material", async () => {
	await expect(startPairing(enrollment, async () => new Response("fixture-secret", { status: 403 }))).rejects.toThrow(
		"Remote pairing rejected: HTTP 403",
	);
});
