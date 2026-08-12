import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@f5-sales-demo/pi-agent-core";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { ImageContent, Model } from "@f5-sales-demo/pi-ai";
import {
	AUTH_PROFILE_UAT_PROFILES,
	assertEnterpriseCredentialContract,
	assertLiteLLMDocumentContract,
	assertRpcProfileState,
	resolveRpcUatLaunch,
	runRpcProfileScenario,
} from "../scripts/auth-profile-rpc-uat";

const RED_IMAGE: ImageContent = { type: "image", data: "red-image", mimeType: "image/png" };

function toolEnd(toolName: string, text: string): AgentEvent {
	return {
		type: "tool_execution_end",
		toolCallId: `call-${toolName}`,
		toolName,
		result: { content: [{ type: "text", text }] },
		isError: false,
	} as AgentEvent;
}

describe("authentication profile RPC UAT matrix", () => {
	it("certifies the exact three requested high profiles", () => {
		expect(AUTH_PROFILE_UAT_PROFILES).toEqual([
			expect.objectContaining({
				id: "litellm-gpt",
				provider: "litellm",
				modelId: "gpt-5.6-sol",
				thinkingLevel: ThinkingLevel.High,
			}),
			expect.objectContaining({
				id: "litellm-opus",
				provider: "anthropic",
				modelId: "claude-opus-5",
				thinkingLevel: ThinkingLevel.High,
			}),
			expect.objectContaining({
				id: "google-enterprise",
				provider: "google-antigravity",
				modelId: "gemini-3.6-flash-high",
				thinkingLevel: ThinkingLevel.High,
				requiredTier: "standard-tier",
			}),
		]);
	});

	it("resolves both source/Bun and compiled/native launch contracts", () => {
		expect(resolveRpcUatLaunch("source", "/repo")).toEqual({
			cliPath: "/repo/packages/coding-agent/src/cli.ts",
			launchMode: "bun",
		});
		expect(resolveRpcUatLaunch("native", "/repo")).toEqual({
			cliPath: "/repo/packages/coding-agent/dist/xcsh",
			launchMode: "native",
		});
	});

	it("rejects a response matrix that started on the wrong model or thinking profile", () => {
		const profile = AUTH_PROFILE_UAT_PROFILES[0]!;
		expect(() =>
			assertRpcProfileState(
				profile,
				{
					model: { provider: "anthropic", id: "claude-opus-5" } as Model,
					thinkingLevel: ThinkingLevel.High,
				},
				[{ provider: profile.provider, id: profile.modelId }],
			),
		).toThrow("active model");
		expect(() =>
			assertRpcProfileState(
				profile,
				{
					model: { provider: profile.provider, id: profile.modelId } as Model,
					thinkingLevel: ThinkingLevel.Medium,
				},
				[{ provider: profile.provider, id: profile.modelId }],
			),
		).toThrow("thinking level");
	});

	it("validates both URL-bearing LiteLLM provider contracts", () => {
		const document = {
			providers: {
				anthropic: { baseUrl: "https://gateway.example.test/anthropic", apiKey: "redacted" },
				litellm: {
					baseUrl: "https://gateway.example.test/api",
					apiKey: "redacted",
					api: "openai-completions",
					modelOverrides: {
						"gpt-5.6-sol": { reasoning: true, input: ["text", "image"] },
					},
				},
			},
		};

		expect(() =>
			assertLiteLLMDocumentContract(AUTH_PROFILE_UAT_PROFILES[0]!, document, "https://gateway.example.test"),
		).not.toThrow();
		expect(() =>
			assertLiteLLMDocumentContract(AUTH_PROFILE_UAT_PROFILES[1]!, document, "https://gateway.example.test"),
		).not.toThrow();
		expect(() =>
			assertLiteLLMDocumentContract(
				AUTH_PROFILE_UAT_PROFILES[1]!,
				{ providers: { anthropic: { baseUrl: "https://wrong.example.test/anthropic" } } },
				"https://gateway.example.test",
			),
		).toThrow("Anthropic base URL");
	});

	it("requires a canonical enterprise credential with exact project and durable standard tier", () => {
		expect(() =>
			assertEnterpriseCredentialContract(
				{ type: "oauth", projectId: "enterprise-project", tierId: "standard-tier" },
				"enterprise-project",
			),
		).not.toThrow();
		expect(() =>
			assertEnterpriseCredentialContract(
				{ type: "oauth", projectId: "enterprise-project", tierId: "free-tier" },
				"enterprise-project",
			),
		).toThrow("standard-tier");
	});

	it("runs multi-turn recall, host tool, direct image, and inspect_image as one reusable scenario", async () => {
		let lastText: string | null = null;
		const prompts: Array<{ message: string; images?: ImageContent[] }> = [];
		const nonce = "uat-[literal].*";
		const client = {
			async promptAndWait(message: string, images?: ImageContent[]): Promise<AgentEvent[]> {
				prompts.push({ message, images });
				if (message.includes("Store this nonce")) lastText = `STORED ${nonce}`;
				else if (message.includes("nonce from the previous turn")) lastText = nonce;
				else if (message.includes("uat_echo")) {
					lastText = `echo:${nonce}`;
					return [toolEnd("uat_echo", `echo:${nonce}`)];
				} else if (images?.length) lastText = "The image contains a red circle.";
				else if (message.includes("inspect_image")) {
					lastText = "The inspected image contains a red circle.";
					return [toolEnd("inspect_image", "red circle")];
				}
				return [];
			},
			async getLastAssistantText() {
				return lastText;
			},
		};

		const report = await runRpcProfileScenario({
			client,
			profile: AUTH_PROFILE_UAT_PROFILES[0]!,
			image: RED_IMAGE,
			imagePath: "/repo/packages/ai/test/data/red-circle.png",
			nonce,
		});

		expect(report.checks.map(check => check.name)).toEqual([
			"multi-turn seed",
			"multi-turn recall",
			"host tool call",
			"direct image input",
			"inspect_image tool call",
		]);
		expect(report.checks.every(check => check.status === "PASS")).toBe(true);
		expect(prompts[3]?.images).toEqual([RED_IMAGE]);
	});

	it("fails closed when a requested tool was not actually called", async () => {
		const nonce = "uat-no-tool";
		let lastText = nonce;
		const client = {
			async promptAndWait(message: string, images?: ImageContent[]): Promise<AgentEvent[]> {
				lastText = images?.length || message.includes("inspect_image") ? "red circle" : nonce;
				return [];
			},
			async getLastAssistantText() {
				return lastText;
			},
		};

		await expect(
			runRpcProfileScenario({
				client,
				profile: AUTH_PROFILE_UAT_PROFILES[0]!,
				image: RED_IMAGE,
				imagePath: "/image.png",
				nonce,
			}),
		).rejects.toThrow("uat_echo");
	});
});
