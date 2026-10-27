import { expect, test } from "bun:test";
import { applicationBuildDefines } from "./application-build-defines";
test("ordinary release builds retain their licensed-input gate", () => {
	expect(() => applicationBuildDefines([], {})).toThrow("Missing licensed Corporate Vertex");
});
test("voice development qualification is credential-free even when build inputs exist", () => {
	expect(
		applicationBuildDefines(["--voice-qualification"], {
			XCSH_VERTEX_OAUTH_CLIENT_ID: "fixture-client-id",
			XCSH_VERTEX_OAUTH_CLIENT_SECRET: "fixture-client-secret",
		}),
	).toEqual({ PI_COMPILED: "true", PI_VERTEX_OAUTH_CLIENT_ID: '""', PI_VERTEX_OAUTH_CLIENT_SECRET: '""' });
});
test("ordinary releases continue embedding their supplied licensed inputs", () => {
	const result = applicationBuildDefines([], {
		XCSH_VERTEX_OAUTH_CLIENT_ID: "fixture-client-id",
		XCSH_VERTEX_OAUTH_CLIENT_SECRET: "fixture-client-secret",
	});
	expect(result.PI_VERTEX_OAUTH_CLIENT_ID).toBe('"fixture-client-id"');
	expect(result.PI_VERTEX_OAUTH_CLIENT_SECRET).toBe('"fixture-client-secret"');
});
