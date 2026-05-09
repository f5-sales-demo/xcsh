import { describe, expect, it } from "bun:test";
import type { Api, Model } from "@f5xc-salesdemos/pi-ai";
import { buildNamedToolChoice } from "../../src/utils/tool-choice";

function mockModel(api: Api): Model<Api> {
	return { api, provider: "test", id: "test-model" } as Model<Api>;
}

describe("buildNamedToolChoice", () => {
	it("returns undefined when model is undefined", () => {
		expect(buildNamedToolChoice("submit_result")).toBeUndefined();
	});

	it("returns named tool choice for anthropic-messages", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("anthropic-messages"));
		expect(result).toEqual({ type: "tool", name: "submit_result" });
	});

	it("returns named tool choice for bedrock-converse-stream", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("bedrock-converse-stream"));
		expect(result).toEqual({ type: "tool", name: "submit_result" });
	});

	it("returns function tool choice for openai-responses", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("openai-responses"));
		expect(result).toEqual({ type: "function", name: "submit_result" });
	});

	it("returns function tool choice for openai-codex-responses", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("openai-codex-responses"));
		expect(result).toEqual({ type: "function", name: "submit_result" });
	});

	it("returns function tool choice for azure-openai-responses", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("azure-openai-responses"));
		expect(result).toEqual({ type: "function", name: "submit_result" });
	});

	it("returns required for google-generative-ai", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("google-generative-ai"));
		expect(result).toBe("required");
	});

	it("returns required for google-vertex", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("google-vertex"));
		expect(result).toBe("required");
	});

	it("returns required as fallback for unknown API types", () => {
		const result = buildNamedToolChoice("submit_result", mockModel("unknown-api" as Api));
		expect(result).toBe("required");
	});
});
