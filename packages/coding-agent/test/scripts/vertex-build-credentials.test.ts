import { describe, expect, it } from "bun:test";
import { vertexBuildDefines } from "../../../../scripts/vertex-build-credentials";

describe("Vertex build credentials", () => {
	it("returns JSON-safe build defines without logging credential values", () => {
		expect(
			vertexBuildDefines({
				XCSH_VERTEX_OAUTH_CLIENT_ID: "test-client-id",
				XCSH_VERTEX_OAUTH_CLIENT_SECRET: "test-client-secret",
			}),
		).toEqual({
			PI_VERTEX_OAUTH_CLIENT_ID: '"test-client-id"',
			PI_VERTEX_OAUTH_CLIENT_SECRET: '"test-client-secret"',
		});
	});

	it("fails an official build when either licensed input is absent", () => {
		expect(() => vertexBuildDefines({ XCSH_VERTEX_OAUTH_CLIENT_ID: "test-client-id" }, true)).toThrow(
			"Missing licensed Corporate Vertex build input: XCSH_VERTEX_OAUTH_CLIENT_SECRET",
		);
	});

	it("uses empty defines for unlicensed source-only builds", () => {
		expect(vertexBuildDefines({})).toEqual({
			PI_VERTEX_OAUTH_CLIENT_ID: '""',
			PI_VERTEX_OAUTH_CLIENT_SECRET: '""',
		});
	});
});
