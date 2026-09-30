import type { Api, KnownProvider } from "../types";
/** Provider endpoints and auth names from pi at 1b347794e2a; xcsh identifiers remain intact. */
export const UPSTREAM_PROVIDER_ROUTES: readonly {
	providerId: KnownProvider;
	baseUrl: string;
	api: Api;
	envVar: string;
	modelsDevProviderId?: string;
}[] = [
	{ providerId: "radius", baseUrl: "https://radius.pi.dev", api: "pi-messages", envVar: "RADIUS_API_KEY" },
	{
		providerId: "typesafe",
		baseUrl: "https://api.typesafe.ai/v1",
		api: "typesafe-system-one",
		envVar: "TYPESAFE_API_KEY",
	},
	{
		providerId: "cloudflare-workers-ai",
		baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
		api: "openai-completions",
		envVar: "CLOUDFLARE_API_KEY",
	},
	{
		providerId: "ant-ling",
		baseUrl: "https://api.ant-ling.com/v1",
		api: "openai-completions",
		envVar: "ANT_LING_API_KEY",
	},
	{
		providerId: "baseten",
		baseUrl: "https://inference.baseten.co/v1",
		api: "openai-completions",
		envVar: "BASETEN_API_KEY",
	},
	{
		providerId: "deepseek",
		baseUrl: "https://api.deepseek.com",
		api: "openai-completions",
		envVar: "DEEPSEEK_API_KEY",
	},
	{
		providerId: "fireworks",
		modelsDevProviderId: "fireworks-ai",
		baseUrl: "https://api.fireworks.ai/inference",
		api: "openai-completions",
		envVar: "FIREWORKS_API_KEY",
	},
	{ providerId: "meta", baseUrl: "https://api.meta.ai/v1", api: "openai-responses", envVar: "META_API_KEY" },
	{
		providerId: "minimax-cn",
		baseUrl: "https://api.minimaxi.com/anthropic",
		api: "anthropic-messages",
		envVar: "MINIMAX_CN_API_KEY",
	},
	{
		providerId: "moonshotai-cn",
		baseUrl: "https://api.moonshot.cn/v1",
		api: "openai-completions",
		envVar: "MOONSHOT_API_KEY",
	},
	{
		providerId: "zai-coding-cn",
		modelsDevProviderId: "zai-coding-plan",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		api: "openai-completions",
		envVar: "ZAI_CODING_CN_API_KEY",
	},
	{
		providerId: "qwen-token-plan",
		modelsDevProviderId: "alibaba-token-plan",
		baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
		api: "openai-completions",
		envVar: "QWEN_TOKEN_PLAN_API_KEY",
	},
	{
		providerId: "qwen-token-plan-cn",
		modelsDevProviderId: "alibaba-token-plan-cn",
		baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
		api: "openai-completions",
		envVar: "QWEN_TOKEN_PLAN_CN_API_KEY",
	},
	{
		providerId: "qwen-token-plan-individual",
		modelsDevProviderId: "alibaba-token-plan",
		baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
		api: "openai-completions",
		envVar: "QWEN_TOKEN_PLAN_API_KEY",
	},
	{
		providerId: "xiaomi-token-plan-ams",
		baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
		api: "openai-completions",
		envVar: "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
	},
	{
		providerId: "xiaomi-token-plan-cn",
		baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
		api: "openai-completions",
		envVar: "XIAOMI_TOKEN_PLAN_CN_API_KEY",
	},
	{
		providerId: "xiaomi-token-plan-sgp",
		baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
		api: "openai-completions",
		envVar: "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
	},
];
