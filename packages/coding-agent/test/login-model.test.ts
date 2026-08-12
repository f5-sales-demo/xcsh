import { describe, expect, it, vi } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import {
	applyModelAfterLogin,
	applyOAuthLoginModel,
	GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE,
	getAvailableLiteLLMLoginModelChoices,
	LITELLM_LOGIN_MODEL_CHOICES,
	OPENAI_CODEX_LOGIN_MODEL_CHOICE,
} from "../src/modes/controllers/login-model";

function makeSession(opts: { model?: { id: string; provider: string }; models: { id: string; provider: string }[] }) {
	const setModel = vi.fn(async (_model: { id: string; provider: string }, _role: string, _opts?: unknown) => {});
	const setThinkingLevel = vi.fn((_level: ThinkingLevel) => {});
	let modelRoles: Record<string, string> = { vision: "google/vision" };
	let routingProfile: "none" | "google-antigravity" | "openai-codex" = "none";
	const session = {
		model: opts.model,
		modelRegistry: { getAll: () => opts.models },
		settings: {
			getModelRoles: () => modelRoles,
			get: () => routingProfile,
			set: (key: string, value: any) => {
				if (key === "modelRoles") modelRoles = value;
				if (key === "routing.profile") routingProfile = value;
			},
		},
		setModel,
		setThinkingLevel,
	};
	return {
		session,
		setModel,
		setThinkingLevel,
		getModelRoles: () => modelRoles,
		getRoutingProfile: () => routingProfile,
	};
}
const M = (id: string, provider = "litellm") => ({ id, provider });
const GPT_CHOICE = LITELLM_LOGIN_MODEL_CHOICES.find(choice => choice.modelId === "gpt-5.6-sol")!;
const OPUS_CHOICE = LITELLM_LOGIN_MODEL_CHOICES.find(choice => choice.modelId === "claude-opus-5")!;

describe("applyModelAfterLogin", () => {
	it("persists the selected model and high thinking", async () => {
		const { session, setModel, setThinkingLevel } = makeSession({
			model: undefined,
			models: [M("gpt-5.6-sol")],
		});
		const applied = await applyModelAfterLogin(session as never, GPT_CHOICE);
		expect(applied).toBe(true);
		expect(setModel).toHaveBeenCalledTimes(1);
		expect(setModel.mock.calls[0][0]).toMatchObject({ id: "gpt-5.6-sol", provider: "litellm" });
		expect(setModel.mock.calls[0][1]).toBe("default");
		expect(setModel.mock.calls[0][2]).toEqual({
			selector: "litellm/gpt-5.6-sol",
			thinkingLevel: ThinkingLevel.High,
		});
		expect(setThinkingLevel).toHaveBeenCalledWith(ThinkingLevel.High);
	});

	it("applies an explicit post-login choice over the existing session model", async () => {
		const { session, setModel } = makeSession({
			model: M("existing"),
			models: [M("claude-opus-5", "anthropic")],
		});
		const applied = await applyModelAfterLogin(session as never, OPUS_CHOICE);
		expect(applied).toBe(true);
		expect(setModel).toHaveBeenCalledWith(
			M("claude-opus-5", "anthropic"),
			"default",
			expect.objectContaining({ selector: "anthropic/claude-opus-5" }),
		);
	});

	it("requires the selected provider and model pair to resolve", async () => {
		const { session, setModel } = makeSession({
			model: undefined,
			models: [M("claude-opus-5", "litellm")],
		});
		const applied = await applyModelAfterLogin(session as never, OPUS_CHOICE);
		expect(applied).toBe(false);
		expect(setModel).not.toHaveBeenCalled();
	});
});

describe("getAvailableLiteLLMLoginModelChoices", () => {
	it("returns only curated models advertised by the authenticated catalog", () => {
		const choices = getAvailableLiteLLMLoginModelChoices(["gpt-5.6-sol", "unrelated-model"]);
		expect(choices).toEqual([GPT_CHOICE]);
	});

	it("puts the vision-capable production default first in the stable display order", () => {
		const choices = getAvailableLiteLLMLoginModelChoices(["claude-opus-5", "gpt-5.6-sol"]);
		expect(choices).toEqual([GPT_CHOICE, OPUS_CHOICE]);
	});

	it("returns no choices when neither curated model is advertised", () => {
		expect(getAvailableLiteLLMLoginModelChoices(["gpt-5.6-terra"])).toEqual([]);
	});
});

describe("applyOAuthLoginModel", () => {
	it("persists Gemini 3.6 Flash High after Google Antigravity login", async () => {
		const { session, setModel, setThinkingLevel, getModelRoles, getRoutingProfile } = makeSession({
			model: M("gpt-5.6-sol"),
			models: [
				M("gemini-3.6-flash-high", "google-antigravity"),
				M("gemini-3.1-pro-high-vertex", "google-antigravity"),
			],
		});

		const applied = await applyOAuthLoginModel(session as never, "google-antigravity");

		expect(applied).toEqual(GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE);
		expect(setModel).toHaveBeenCalledWith(M("gemini-3.6-flash-high", "google-antigravity"), "default", {
			selector: "google-antigravity/gemini-3.6-flash-high",
			thinkingLevel: ThinkingLevel.High,
		});
		expect(setThinkingLevel).toHaveBeenCalledWith(ThinkingLevel.High);
		expect(getModelRoles()).toMatchObject({
			default: "google-antigravity/gemini-3.6-flash-high:high",
			plan: "google-antigravity/gemini-3.1-pro-high-vertex:high",
			vision: "google/vision",
		});
		expect(getRoutingProfile()).toBe("google-antigravity");
	});

	it("applies the canonical Gemini profile after enterprise alias login", async () => {
		const { session, setModel, setThinkingLevel } = makeSession({
			model: M("gpt-5.6-sol"),
			models: [
				M("gemini-3.6-flash-high", "google-antigravity"),
				M("gemini-3.1-pro-high-vertex", "google-antigravity"),
			],
		});

		const applied = await applyOAuthLoginModel(session as never, "google-antigravity-enterprise");

		expect(applied).toEqual(GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE);
		expect(setModel).toHaveBeenCalledWith(M("gemini-3.6-flash-high", "google-antigravity"), "default", {
			selector: "google-antigravity/gemini-3.6-flash-high",
			thinkingLevel: ThinkingLevel.High,
		});
		expect(setThinkingLevel).toHaveBeenCalledWith(ThinkingLevel.High);
	});

	it("does not replace the current model when the preferred provider model is unavailable", async () => {
		const { session, setModel, setThinkingLevel } = makeSession({
			model: M("gpt-5.6-sol"),
			models: [M("gemini-3-flash", "google-antigravity")],
		});

		const applied = await applyOAuthLoginModel(session as never, "google-antigravity");

		expect(applied).toBeUndefined();
		expect(setModel).not.toHaveBeenCalled();
		expect(setThinkingLevel).not.toHaveBeenCalled();
	});

	it("does not apply a subscription profile from stale entitlement discovery", async () => {
		const { session, setModel } = makeSession({
			models: [
				M("gemini-3.6-flash-high", "google-antigravity"),
				M("gemini-3.1-pro-high-vertex", "google-antigravity"),
			],
		});
		(session.modelRegistry as any).getProviderDiscoveryState = () => ({ status: "cached", stale: true });

		const result = await applyOAuthLoginModel(session as never, "google-antigravity");

		expect(result).toBeUndefined();
		expect(setModel).not.toHaveBeenCalled();
	});

	it("does not change models for OAuth providers without a preferred login model", async () => {
		const { session, setModel } = makeSession({
			model: M("gpt-5.6-sol"),
			models: [M("claude-opus-5", "anthropic")],
		});

		const applied = await applyOAuthLoginModel(session as never, "anthropic");

		expect(applied).toBeUndefined();
		expect(setModel).not.toHaveBeenCalled();
	});

	it("applies the complete OpenAI Codex subscription profile", async () => {
		const { session, setModel, getModelRoles, getRoutingProfile } = makeSession({
			model: undefined,
			models: [
				M("gpt-5.6-luna", "openai-codex"),
				M("gpt-5.6-terra", "openai-codex"),
				M("gpt-5.6-sol", "openai-codex"),
			],
		});

		const applied = await applyOAuthLoginModel(session as never, "openai-codex");

		expect(applied).toEqual(OPENAI_CODEX_LOGIN_MODEL_CHOICE);
		expect(setModel).toHaveBeenCalledWith(M("gpt-5.6-terra", "openai-codex"), "default", {
			selector: "openai-codex/gpt-5.6-terra",
			thinkingLevel: ThinkingLevel.Medium,
		});
		expect(getModelRoles()).toMatchObject({
			smol: "openai-codex/gpt-5.6-luna:low",
			default: "openai-codex/gpt-5.6-terra:medium",
			slow: "openai-codex/gpt-5.6-sol:high",
			plan: "openai-codex/gpt-5.6-sol:high",
		});
		expect(getRoutingProfile()).toBe("openai-codex");
	});
});
