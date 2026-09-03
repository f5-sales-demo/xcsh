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
	| "google-vertex"
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
	/** Non-secret device code copied only after the user explicitly requests it. */
	copyText?: string;
};

export type OAuthAuthInfo = {
	/** URL presented for copying (for example a hosted callback suitable for headless use). */
	url: string;
	/** Optional URL opened automatically when it differs from the displayed URL. */
	openUrl?: string;
	instructions?: string;
	kind?: "browser" | "device";
	userCode?: string;
	expiresInSeconds?: number;
};

export interface OAuthProviderInfo {
	id: OAuthProviderId;
	name: string;
	available: boolean;
	/** Provider ID used for persisted credentials and model routing. */
	canonicalId?: OAuthProvider;
	/** Entry is offered for login but omitted from logout to avoid alias duplicates. */
	loginOnly?: boolean;
	/** Short secondary text displayed by interactive login pickers. */
	description?: string;
	/** Stable login-menu order; lower values are shown first. */
	loginOrder?: number;
}

/** Resolve login-only aliases to the provider ID used by credentials and models. */
export function canonicalizeOAuthProviderId(provider: string): string {
	return provider;
}

export interface OAuthController {
	onAuth?(info: OAuthAuthInfo): void;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onPrompt?(prompt: OAuthPrompt): Promise<string>;
	signal?: AbortSignal;
	/** Provider-specific ChatGPT login choice selected by an interactive client. */
	method?: "auto" | "browser" | "device";
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
