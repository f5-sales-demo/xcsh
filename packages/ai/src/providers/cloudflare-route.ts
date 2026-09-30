import type { StreamOptions } from "../types";
/** Resolve only Cloudflare's configured path fields; preserve any endpoint prefix. */
export function resolveCloudflareEndpoint(
	provider: string,
	baseUrl: string,
	options?: Pick<StreamOptions, "accountId" | "gatewayId">,
): string {
	if (!provider.startsWith("cloudflare-")) return baseUrl;
	for (const [placeholder, value] of [
		["CLOUDFLARE_ACCOUNT_ID", options?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID],
		["CLOUDFLARE_GATEWAY_ID", options?.gatewayId ?? process.env.CLOUDFLARE_GATEWAY_ID],
	] as const) {
		const legacy = placeholder === "CLOUDFLARE_ACCOUNT_ID" ? "<account>" : "<gateway>";
		if (baseUrl.includes(`{${placeholder}}`) || baseUrl.includes(legacy)) {
			if (!value) throw new Error(`Cloudflare endpoint requires ${placeholder}`);
			baseUrl = baseUrl
				.replaceAll(`{${placeholder}}`, encodeURIComponent(value))
				.replaceAll(legacy, encodeURIComponent(value));
		}
	}
	return baseUrl;
}
export function cloudflareGatewayHeaders(
	baseUrl: string,
	apiKey: string,
	headers: Record<string, string>,
): Record<string, string> {
	if (new URL(baseUrl).hostname !== "gateway.ai.cloudflare.com") return headers;
	const result = Object.fromEntries(
		Object.entries(headers).filter(([key]) => !["authorization", "x-api-key"].includes(key.toLowerCase())),
	);
	result["cf-aig-authorization"] = `Bearer ${apiKey}`;
	return result;
}
