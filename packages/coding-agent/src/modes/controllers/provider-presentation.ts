import { getOAuthProviders } from "@f5-sales-demo/pi-ai";

export type ProviderCategory = "Subscriptions" | "Cloud & API" | "Local & proxies" | "Other services";
const names: Record<string, string> = {
	anthropic: "Anthropic",
	"openai-codex": "ChatGPT",
	openai: "OpenAI API",
	"google-vertex": "Google Vertex AI",
	vllm: "vLLM",
	ollama: "Ollama",
	"lm-studio": "LM Studio",
	"llama.cpp": "llama.cpp",
};
export function getProviderDisplayName(id: string): string {
	return names[id] ?? getOAuthProviders().find(provider => provider.id === id)?.name ?? id;
}
export function providerPresentation(id: string): { access: string; category: ProviderCategory; description: string } {
	if (["ollama", "vllm", "lm-studio", "llama.cpp", "litellm"].includes(id))
		return {
			access: "Local / proxy",
			category: "Local & proxies",
			description: "Connect to your model server or proxy endpoint.",
		};
	if (
		["anthropic", "openai-codex", "github-copilot", "google-antigravity", "google-antigravity-enterprise"].includes(
			id,
		)
	)
		return {
			access: "Subscription",
			category: "Subscriptions",
			description: "Sign in with a provider subscription. Model availability depends on your account.",
		};
	const provider = getOAuthProviders().find(provider => provider.id === id);
	if (id === "google-vertex")
		return {
			access: "Cloud account",
			category: "Cloud & API",
			description: "Enterprise Google Vertex AI sign-in with a project and region.",
		};
	return {
		access: "API / account",
		category: provider?.loginOnly ? "Other services" : "Cloud & API",
		description: provider?.description ?? "Connect using the provider's API credentials.",
	};
}
