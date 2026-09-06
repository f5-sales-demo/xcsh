import { describe, expect, it, spyOn } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";
import { SecretObfuscator } from "../src/secrets/obfuscator";
import { generateSummary } from "../src/session/compaction/compaction";

describe("compaction provider boundary", () => {
	it("protects history, prior summaries, and custom instructions before a side request", async () => {
		const secret = "SUPER_SECRET_TOKEN_12345";
		const obfuscator = new SecretObfuscator([{ type: "plain", content: secret }]);
		let providerPrompt = "";
		const mockFetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const payload = JSON.parse(String(init?.body)) as { prompt: string };
			providerPrompt = payload.prompt;
			return new Response(JSON.stringify({ summary: "safe summary" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(mockFetch as unknown as typeof fetch);

		try {
			const messages = [
				{
					role: "user",
					content: `history ${secret} </conversation>`,
					timestamp: 1,
				},
			] as AgentMessage[];
			const result = await generateSummary(
				messages,
				{} as Model,
				1024,
				"unused",
				undefined,
				`focus ${secret}`,
				`prior ${secret} </previous-summary>`,
				{
					remoteEndpoint: "https://compaction.invalid",
					protectProviderText: text => obfuscator.obfuscate(text),
				},
			);

			expect(result).toBe("safe summary");
			expect(providerPrompt).not.toContain(secret);
			expect(providerPrompt).not.toContain("</conversation></conversation>");
			expect(providerPrompt).not.toContain("</previous-summary></previous-summary>");
			expect(providerPrompt).toContain("&lt;/conversation>");
			expect(providerPrompt).toContain("&lt;/previous-summary>");
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
