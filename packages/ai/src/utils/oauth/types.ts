export type OAuthCredentials = {
	refresh: string;
	access: string;
	expires: number;
	enterpriseUrl?: string;
	projectId?: string;
	/** Durable entitlement certified during enterprise project discovery. */
	tierId?: string;
	email?: string;
	accountId?: string;
};

export type OAuthProvider =
	| "alibaba-coding-plan"
	| "anthropic"
	| "cerebras"
	| "cloudflare-ai-gateway"
	| "cursor"
	| "github-copilot"
	| "google-gemini-cli"
	| "google-antigravity"
	| "google-antigravity-enterprise"
	| "gitlab-duo"
	| "huggingface"
	| "kimi-code"
	| "kilo"
	| "kagi"
	| "litellm"
	| "lm-studio"
	| "minimax-code"
	| "minimax-code-cn"
	| "moonshot"
	| "nvidia"
	| "nanogpt"
	| "ollama"
	| "openai"
	/** Legacy ID retained only so stored credentials can be explicitly removed. */
	| "openai-codex"
	| "opencode-go"
	| "opencode-zen"
	| "parallel"
	| "perplexity"
	| "qianfan"
	| "qwen-portal"
	| "synthetic"
	| "tavily"
	| "together"
	| "venice"
	| "vercel-ai-gateway"
	| "vllm"
	| "xiaomi"
	| "zenmux"
	| "zai";

export type OAuthProviderId = OAuthProvider | (string & {});

export type OAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
	/** Render this prompt with obscured input because it collects a credential. */
	secret?: boolean;
};

export type OAuthAuthInfo = {
	url: string;
	instructions?: string;
};

export interface OAuthProviderInfo {
	id: OAuthProviderId;
	name: string;
	available: boolean;
	/** Provider ID used for persisted credentials and model routing. */
	canonicalId?: OAuthProvider;
	/** Entry is offered for login but omitted from logout to avoid alias duplicates. */
	loginOnly?: boolean;
}

/** Resolve login-only aliases to the provider ID used by credentials and models. */
export function canonicalizeOAuthProviderId(provider: string): string {
	return provider === "google-antigravity-enterprise" ? "google-antigravity" : provider;
}

export interface OAuthController {
	onAuth?(info: OAuthAuthInfo): void;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onPrompt?(prompt: OAuthPrompt): Promise<string>;
	signal?: AbortSignal;
}

export interface OAuthLoginCallbacks extends OAuthController {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
}

export interface OAuthProviderInterface {
	readonly id: OAuthProviderId;
	readonly name: string;
	readonly sourceId?: string;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials | string>;
	refreshToken?(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	getApiKey?(credentials: OAuthCredentials): string;
}
