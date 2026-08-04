import { describe, expect, it, vi } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import {
	applyModelAfterLogin,
	applyOAuthLoginModel,
	GOOGLE_ANTIGRAVITY_LOGIN_MODEL_CHOICE,
	getAvailableLiteLLMLoginModelChoices,
	getAvailableVllmLoginModelChoices,
	LITELLM_LOGIN_MODEL_CHOICES,
} from "../src/modes/controllers/login-model";

function makeSession(opts: { model?: { id: string; provider: string }; models: { id: string; provider: string }[] }) {
	const setModel = vi.fn(async (_model: { id: string; provider: string }, _role: string, _opts?: unknown) => {});
	const setThinkingLevel = vi.fn((_level: ThinkingLevel) => {});
	const session = {
		model: opts.model,
		modelRegistry: { getAll: () => opts.models },
		setModel,
		setThinkingLevel,
	};
	return { session, setModel, setThinkingLevel };
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
		expect(choices).toEqual([OPUS_CHOICE, GPT_CHOICE]);
	});

	it("returns no choices when neither curated model is advertised", () => {
		expect(getAvailableLiteLLMLoginModelChoices(["gpt-5.6-terra"])).toEqual([]);
	});
});

describe("getAvailableVllmLoginModelChoices", () => {
	it("filters the refreshed registry by provider and probed catalog", () => {
		const choices = getAvailableVllmLoginModelChoices(
			[
				{ ...M("model-b", "vllm"), name: "Model B" },
				{ ...M("model-a", "vllm"), name: "Model A" },
				{ ...M("not-probed", "vllm"), name: "Not Probed" },
				{ ...M("model-a", "other"), name: "Wrong Provider" },
			] as never,
			["model-b", "model-a"],
		);

		expect(choices.map(choice => `${choice.label}:${choice.modelId}`)).toEqual([
			"Model A:model-a",
			"Model B:model-b",
		]);
		expect(choices.every(choice => choice.provider === "vllm")).toBe(true);
		expect(choices.every(choice => choice.thinkingLevel === ThinkingLevel.Off)).toBe(true);
	});

	it("builds a single choice that can be applied as the default model", async () => {
		const model = { ...M("local-tool-model", "vllm"), name: "Local Tool Model" };
		const [choice] = getAvailableVllmLoginModelChoices([model] as never, [model.id]);
		const { session, setModel, setThinkingLevel } = makeSession({ models: [model] });

		expect(choice).toBeDefined();
		expect(await applyModelAfterLogin(session as never, choice!)).toBe(true);
		expect(setModel).toHaveBeenCalledWith(model, "default", {
			selector: "vllm/local-tool-model",
			thinkingLevel: ThinkingLevel.Off,
		});
		expect(setThinkingLevel).toHaveBeenCalledWith(ThinkingLevel.Off);
	});
});

describe("applyOAuthLoginModel", () => {
	it("persists Gemini 3.6 Flash High after Google Antigravity login", async () => {
		const { session, setModel, setThinkingLevel } = makeSession({
			model: M("gpt-5.6-sol"),
			models: [M("gemini-3.6-flash-high", "google-antigravity")],
		});

		const applied = await applyOAuthLoginModel(session as never, "google-antigravity");

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

	it("does not change models for OAuth providers without a preferred login model", async () => {
		const { session, setModel } = makeSession({
			model: M("gpt-5.6-sol"),
			models: [M("claude-opus-5", "anthropic")],
		});

		const applied = await applyOAuthLoginModel(session as never, "anthropic");

		expect(applied).toBeUndefined();
		expect(setModel).not.toHaveBeenCalled();
	});
});
