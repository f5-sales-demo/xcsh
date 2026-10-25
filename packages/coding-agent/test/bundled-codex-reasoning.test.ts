import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { ModelRegistry } from "../src/config/model-registry";
import { AuthStorage } from "../src/session/auth-storage";
import { resolveThinkingLevelForModel } from "../src/thinking";

for (const id of ["gpt-6.1-sol", "gpt-6-sol"]) {
	test(`registry startup retains bundled subscription reasoning for ${id}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-bundled-thinking-"));
		const auth = await AuthStorage.create(":memory:");
		try {
			const registry = new ModelRegistry(auth, join(root, "models.json"));
			const bundled = getBundledModel("openai-codex", id);
			const selected = registry.find("openai-codex", id)!;
			expect(selected.thinking).toEqual(bundled.thinking);
			expect(resolveThinkingLevelForModel(selected, ThinkingLevel.Ultra)).toBe(ThinkingLevel.Ultra);
		} finally {
			auth.close();
			await rm(root, { recursive: true, force: true });
		}
	});
}

test("provider-discovered restriction and explicit override remain authoritative", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-discovered-thinking-"));
	const auth = await AuthStorage.create(":memory:");
	const originalFetch = globalThis.fetch;
	try {
		await auth.set("openai-codex", {
			type: "oauth",
			access: "synthetic-access",
			refresh: "synthetic-refresh",
			expires: Date.now() + 60000,
			accountId: "example-account",
		});
		globalThis.fetch = (async (input: unknown) =>
			String(input).includes("registry.npmjs.org")
				? Response.json({ version: "0.152.1" })
				: Response.json({
						models: [
							{
								slug: "gpt-6.1-sol",
								display_name: "Fixture",
								supported_in_api: true,
								default_reasoning_level: "high",
								supported_reasoning_levels: [{ effort: "high", description: "Provider restricted fixture" }],
								input_modalities: ["text"],
							},
						],
					})) as unknown as typeof fetch;
		const path = join(root, "models.json");
		const registry = new ModelRegistry(auth, path);
		await registry.refreshProvider("openai-codex", "online");
		expect(registry.find("openai-codex", "gpt-6.1-sol")?.thinking?.supportedLevels.map(x => x.effort)).toEqual([
			"high",
		]);
		expect(() =>
			resolveThinkingLevelForModel(registry.find("openai-codex", "gpt-6.1-sol")!, ThinkingLevel.Ultra),
		).toThrow();
		await writeFile(
			path,
			JSON.stringify({
				providers: {
					"openai-codex": {
						baseUrl: "https://chatgpt.com/backend-api",
						modelOverrides: {
							"gpt-6.1-sol": {
								thinking: {
									mode: "effort",
									defaultLevel: "low",
									supportedLevels: [{ effort: "low", description: "Explicit fixture" }],
								},
							},
						},
					},
				},
			}),
		);
		const override = new ModelRegistry(auth, path);
		expect(override.find("openai-codex", "gpt-6.1-sol")?.thinking?.supportedLevels.map(x => x.effort)).toEqual([
			"low",
		]);
	} finally {
		globalThis.fetch = originalFetch;
		auth.close();
		await rm(root, { recursive: true, force: true });
	}
});
