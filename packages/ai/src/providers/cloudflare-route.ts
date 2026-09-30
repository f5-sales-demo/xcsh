import type { Api, Model, StreamOptions } from "../types";

/** Retain configured Gateway roots while selecting the native passthrough contract. */
export function enrichCloudflareModel<TApi extends Api>(model: Model<TApi>): Model<TApi> {
	if (model.provider === "cloudflare-workers-ai")
		return { ...model, compat: { ...model.compat, sendSessionAffinityHeaders: true } as Model<TApi>["compat"] };
	if (model.provider !== "cloudflare-ai-gateway") return model;
	const [prefix, ...rest] = model.id.split("/");
	const upstream = ["workers-ai", "openai", "anthropic"].includes(prefix!)
		? prefix
		: model.api === "openai-completions"
			? "workers-ai"
			: model.api === "openai-responses"
				? "openai"
				: "anthropic";
	const root = model.baseUrl.replace(/\/(?:anthropic|openai(?:\/v1)?|compat)\/?$/, "");
	return {
		...model,
		id: upstream !== "workers-ai" && prefix === upstream ? rest.join("/") : model.id,
		api: (upstream === "workers-ai"
			? "openai-completions"
			: upstream === "openai"
				? "openai-responses"
				: "anthropic-messages") as TApi,
		baseUrl: `${root}/${upstream === "workers-ai" ? "compat" : upstream}`,
		...(upstream !== "openai"
			? { compat: { ...model.compat, sendSessionAffinityHeaders: true } as Model<TApi>["compat"] }
			: {}),
	};
}

/** Gateway catalog entries win; mirror only missing, chat-capable Workers models. */
export function mirrorCloudflareWorkersModels(models: Model[]): void {
	const ids = new Set(models.filter(model => model.provider === "cloudflare-ai-gateway").map(model => model.id));
	for (const model of [...models]) {
		if (model.provider !== "cloudflare-workers-ai" || model.api !== "openai-completions") continue;
		const id = `workers-ai/${model.id}`;
		if (ids.has(id)) continue;
		ids.add(id);
		models.push(
			enrichCloudflareModel({
				...model,
				id,
				provider: "cloudflare-ai-gateway",
				baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
			}),
		);
	}
}
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
