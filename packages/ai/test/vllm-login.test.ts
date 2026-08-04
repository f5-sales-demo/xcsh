import { describe, expect, it } from "bun:test";
import type { OAuthPrompt } from "../src/utils/oauth/types";
import { DEFAULT_VLLM_BASE_URL, loginVllm, type VllmLoginResult } from "../src/utils/oauth/vllm";

describe("loginVllm", () => {
	it("prefills the local endpoint and accepts an unauthenticated fresh login", async () => {
		const prompts: OAuthPrompt[] = [];
		const result = await loginVllm({
			onPrompt: async prompt => {
				prompts.push(prompt);
				return "";
			},
		});

		expect(result).toEqual<VllmLoginResult>({ baseUrl: DEFAULT_VLLM_BASE_URL, apiKey: "" });
		expect(prompts).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("Base URL"),
				initialValue: DEFAULT_VLLM_BASE_URL,
			}),
			expect.objectContaining({
				message: expect.stringContaining("API Key"),
				allowEmpty: true,
				initialValue: "",
				masked: true,
			}),
		]);
	});

	it("prefills and preserves an existing endpoint and key when submitted unchanged", async () => {
		const prompts: OAuthPrompt[] = [];
		const result = await loginVllm({
			defaults: {
				baseUrl: "https://vllm.example.com/v1/",
				apiKey: "existing-secret",
			},
			onPrompt: async prompt => {
				prompts.push(prompt);
				return prompt.initialValue ?? "";
			},
		});

		expect(result).toEqual({ baseUrl: "https://vllm.example.com/v1", apiKey: "existing-secret" });
		expect(prompts[0]?.initialValue).toBe("https://vllm.example.com/v1/");
		expect(prompts[1]).toMatchObject({ initialValue: "existing-secret", masked: true, allowEmpty: true });
	});

	it("allows a prefilled API key to be cleared", async () => {
		let promptIndex = 0;
		const result = await loginVllm({
			defaults: {
				baseUrl: "https://vllm.example.com/v1",
				apiKey: "existing-secret",
			},
			onPrompt: async prompt => {
				promptIndex += 1;
				return promptIndex === 1 ? (prompt.initialValue ?? "") : "";
			},
		});

		expect(result).toEqual({ baseUrl: "https://vllm.example.com/v1", apiKey: "" });
	});

	it("trims new values and permits remote HTTP endpoints", async () => {
		let promptIndex = 0;
		const result = await loginVllm({
			onPrompt: async () => {
				promptIndex += 1;
				return promptIndex === 1 ? "  http://10.20.30.40:9000/v1///  " : "  bearer-secret  ";
			},
		});

		expect(result).toEqual({ baseUrl: "http://10.20.30.40:9000/v1", apiKey: "bearer-secret" });
	});

	it("rejects non-HTTP endpoints", async () => {
		await expect(
			loginVllm({
				onPrompt: async () => "file:///tmp/vllm.sock",
			}),
		).rejects.toThrow("HTTP or HTTPS");
	});

	it("does not open a browser or documentation URL", async () => {
		let authCalls = 0;
		await loginVllm({
			onAuth: () => {
				authCalls += 1;
			},
			onPrompt: async () => "",
		});
		expect(authCalls).toBe(0);
	});

	it("honors cancellation before prompting", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			loginVllm({
				signal: controller.signal,
				onPrompt: async () => "",
			}),
		).rejects.toThrow("Login cancelled");
	});
});
