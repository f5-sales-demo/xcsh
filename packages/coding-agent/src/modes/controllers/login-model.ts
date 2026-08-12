import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { canonicalizeOAuthProviderId, type Model } from "@f5-sales-demo/pi-ai";
import { applySubscriptionProfileRoles, type SubscriptionProfileId } from "../../routing/subscription-profiles";

export interface LoginModelChoice {
	label: string;
	description: string;
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
}

export interface LiteLLMLoginModelChoice extends LoginModelChoice {
	provider: "anthropic" | "litellm";
	modelId: "claude-opus-5" | "gpt-5.6-sol";
}

export const LITELLM_LOGIN_MODEL_CHOICES: readonly LiteLLMLoginModelChoice[] = [
	{
		label: "GPT-5.6 Sol",
		description: "OpenAI-compatible model with high reasoning",
		provider: "litellm",
		modelId: "gpt-5.6-sol",
		thinkingLevel: ThinkingLevel.High,
	},
	{
		label: "Claude Opus 5",
		description: "Anthropic Messages model with high reasoning",
		provider: "anthropic",
		modelId: "claude-opus-5",
		thinkingLevel: ThinkingLevel.High,
	},
];

export const GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE: LoginModelChoice = {
	label: "Gemini 3.6 Flash High",
	description: "Google Antigravity model with high reasoning",
	provider: "google-antigravity",
	modelId: "gemini-3.6-flash-high",
	thinkingLevel: ThinkingLevel.High,
};

export const OPENAI_CODEX_LOGIN_MODEL_CHOICE: LoginModelChoice = {
	label: "GPT-5.6 Terra",
	description: "Balanced OpenAI Codex subscription model with medium reasoning",
	provider: "openai-codex",
	modelId: "gpt-5.6-terra",
	thinkingLevel: ThinkingLevel.Medium,
};

export function getAvailableLiteLLMLoginModelChoices(availableModelIds: readonly string[]): LiteLLMLoginModelChoice[] {
	const available = new Set(availableModelIds);
	return LITELLM_LOGIN_MODEL_CHOICES.filter(choice => available.has(choice.modelId));
}

/**
 * Minimal session surface needed to apply a model after a successful login.
 * Kept structural so the login flow can call it without pulling in the full
 * AgentSession type, and so it stays trivially unit-testable.
 */
interface BaseModelApplicableSession {
	modelRegistry: { getAll(): Model[] };
	setModel(model: Model, role: "default", options: { selector: string; thinkingLevel: ThinkingLevel }): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
}

interface ModelApplicableSession extends BaseModelApplicableSession {
	modelRegistry: {
		getAll(): Model[];
		getProviderDiscoveryState?(provider: string): { status: string; stale: boolean } | undefined;
	};
	settings?: {
		getModelRoles(): Readonly<Record<string, string | undefined>>;
		get?(key: "routing.profile"): "none" | SubscriptionProfileId;
		set(key: "modelRoles", value: Record<string, string>): void;
		set(key: "routing.profile", value: "none" | SubscriptionProfileId): void;
	};
}

/**
 * After a successful `/login`, apply the model the user explicitly selected as
 * the active and persisted default model, including its thinking level.
 *
 * Returns true when the exact provider/model pair resolves after registry refresh.
 */
export async function applyModelAfterLogin(
	session: BaseModelApplicableSession,
	choice: LoginModelChoice,
): Promise<boolean> {
	const resolved = session.modelRegistry
		.getAll()
		.find(model => model.provider === choice.provider && model.id === choice.modelId);
	if (!resolved) return false;
	const selector = `${choice.provider}/${choice.modelId}`;
	await session.setModel(resolved, "default", {
		selector,
		thinkingLevel: choice.thinkingLevel,
	});
	session.setThinkingLevel(choice.thinkingLevel);
	return true;
}

/**
 * Apply a provider's curated model after OAuth login.
 *
 * Providers without a curated choice, or registries that do not advertise the
 * exact preferred model, leave the active and persisted model unchanged.
 */
export async function applyOAuthLoginModel(
	session: ModelApplicableSession,
	providerId: string,
): Promise<LoginModelChoice | undefined> {
	const canonicalProvider = canonicalizeOAuthProviderId(providerId);
	const choice =
		canonicalProvider === GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE.provider
			? GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE
			: canonicalProvider === OPENAI_CODEX_LOGIN_MODEL_CHOICE.provider
				? OPENAI_CODEX_LOGIN_MODEL_CHOICE
				: undefined;
	if (!choice) return undefined;
	const discovery = session.modelRegistry.getProviderDiscoveryState?.(canonicalProvider);
	if (session.modelRegistry.getProviderDiscoveryState && (discovery?.status !== "ok" || discovery.stale)) {
		return undefined;
	}

	const settings = session.settings;
	const previousProfile = settings?.get?.("routing.profile") ?? "none";
	const previousRoles = settings
		? Object.fromEntries(
				Object.entries(settings.getModelRoles()).filter(
					(entry): entry is [string, string] => entry[1] !== undefined,
				),
			)
		: {};
	if (settings) {
		const available = session.modelRegistry.getAll().map(model => `${model.provider}/${model.id}`);
		const profile = applySubscriptionProfileRoles(
			canonicalProvider as SubscriptionProfileId,
			previousRoles,
			available,
		);
		if (!profile.applied) return undefined;
		settings.set("modelRoles", profile.roles);
		settings.set("routing.profile", canonicalProvider as SubscriptionProfileId);
	}

	try {
		const applied = await applyModelAfterLogin(session, choice);
		if (!applied && settings) {
			settings.set("modelRoles", previousRoles);
			settings.set("routing.profile", previousProfile);
		}
		return applied ? choice : undefined;
	} catch (error) {
		if (settings) {
			settings.set("modelRoles", previousRoles);
			settings.set("routing.profile", previousProfile);
		}
		throw error;
	}
}
