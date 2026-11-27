/** Keep acceptance credentials on the requested provider Messages endpoint. */
export function assertAnthropicParityRoute(requestUrl: string, baseUrl: string): void {
	const request = new URL(requestUrl);
	const expected = new URL(baseUrl);
	if (request.origin !== expected.origin || request.pathname !== `${expected.pathname.replace(/\/$/, "")}/v1/messages`)
		throw new Error("Unexpected provider request route");
}
