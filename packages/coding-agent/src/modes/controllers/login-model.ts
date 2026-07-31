import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";

export interface LiteLLMLoginModelChoice {
	label: string;
	description: string;
	provider: "anthropic" | "litellm";
	modelId: "claude-opus-5" | "gpt-5.6-sol";
	thinkingLevel: ThinkingLevel;
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

export function getAvailableLiteLLMLoginModelChoices(availableModelIds: readonly string[]): LiteLLMLoginModelChoice[] {
	const available = new Set(availableModelIds);
	return LITELLM_LOGIN_MODEL_CHOICES.filter(choice => available.has(choice.modelId));
}

/**
 * Minimal session surface needed to apply a model after a successful login.
 * Kept structural so the login flow can call it without pulling in the full
 * AgentSession type, and so it stays trivially unit-testable.
 */
interface ModelApplicableSession {
	modelRegistry: { getAll(): Model[] };
	setModel(model: Model, role: "default", options: { selector: string; thinkingLevel: ThinkingLevel }): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
}

/**
 * After a successful `/login`, apply the model the user explicitly selected as
 * the active and persisted default model, including its thinking level.
 *
 * Returns true when the exact provider/model pair resolves after registry refresh.
 */
export async function applyModelAfterLogin(
	session: ModelApplicableSession,
	choice: LiteLLMLoginModelChoice,
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
