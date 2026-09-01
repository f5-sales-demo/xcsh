export const VERTEX_CLIENT_ID_ENV = "XCSH_VERTEX_OAUTH_CLIENT_ID";
export const VERTEX_CLIENT_SECRET_ENV = "XCSH_VERTEX_OAUTH_CLIENT_SECRET";

type BuildEnvironment = Record<string, string | undefined>;

export function vertexBuildDefines(
	environment: BuildEnvironment = Bun.env,
	required = false,
): Record<string, string> {
	const clientId = environment[VERTEX_CLIENT_ID_ENV]?.trim() ?? "";
	const clientSecret = environment[VERTEX_CLIENT_SECRET_ENV]?.trim() ?? "";
	if (required) {
		if (!clientId) throw new Error(`Missing licensed Corporate Vertex build input: ${VERTEX_CLIENT_ID_ENV}`);
		if (!clientSecret) throw new Error(`Missing licensed Corporate Vertex build input: ${VERTEX_CLIENT_SECRET_ENV}`);
	}
	return {
		PI_VERTEX_OAUTH_CLIENT_ID: JSON.stringify(clientId),
		PI_VERTEX_OAUTH_CLIENT_SECRET: JSON.stringify(clientSecret),
	};
}
