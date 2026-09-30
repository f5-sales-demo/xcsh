import { fetchOpenAICompatibleModels } from "../utils/discovery/openai-compatible";
import type { ProviderDescriptor } from "./descriptors";

export { UPSTREAM_PROVIDER_ROUTES } from "./upstream-provider-routes";

import { UPSTREAM_PROVIDER_ROUTES } from "./upstream-provider-routes";
export function upstreamProviderDescriptors(): ProviderDescriptor[] {
	return UPSTREAM_PROVIDER_ROUTES.map(route => ({
		providerId: route.providerId,
		defaultModel: "",
		catalogDiscovery: {
			label: route.providerId,
			envVars: [route.envVar],
			...(route.providerId === "radius"
				? { allowUnauthenticated: true, oauthProvider: "radius" as const }
				: route.providerId === "meta"
					? { oauthProvider: "meta" as const }
					: {}),
		},
		...(route.providerId === "radius" ? { allowUnauthenticated: true } : {}),
		createModelManagerOptions: config => ({
			providerId: route.providerId,
			...(config.apiKey || route.providerId === "radius"
				? {
						fetchDynamicModels: async signal => {
							if (route.providerId === "typesafe") return [];
							if (route.providerId === "radius") {
								const response = await fetch(new URL("/v1/config", config.baseUrl ?? route.baseUrl), {
									headers: {
										...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
										Accept: "application/json",
									},
									signal,
								});
								if (!response.ok) throw new Error(`Radius catalog HTTP ${response.status}`);
								const body = (await response.json()) as { baseUrl: string; models: import("../types").Model[] };
								if (typeof body.baseUrl !== "string" || !Array.isArray(body.models))
									throw new Error("Invalid Radius catalog");
								return body.models.map(model => ({
									...model,
									provider: "radius",
									api: "pi-messages",
									baseUrl: body.baseUrl,
								}));
							}
							const baseUrl = (config.baseUrl ?? route.baseUrl).replace(
								"{CLOUDFLARE_ACCOUNT_ID}",
								process.env.CLOUDFLARE_ACCOUNT_ID ?? "{CLOUDFLARE_ACCOUNT_ID}",
							);
							if (baseUrl.includes("{CLOUDFLARE_ACCOUNT_ID}"))
								throw new Error("Cloudflare catalog requires account ID");
							return fetchOpenAICompatibleModels({
								provider: route.providerId,
								api: route.api,
								baseUrl,
								apiKey: config.apiKey,
								signal,
							});
						},
					}
				: {}),
		}),
	}));
}
