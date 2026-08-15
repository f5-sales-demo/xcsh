import { describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage } from "../src/auth-storage";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Context, Model } from "../src/types";
import { getOAuthProviders } from "../src/utils/oauth";

const testContext: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

describe("unsupported OpenAI Codex OAuth removal", () => {
	test("does not expose ChatGPT subscription login and promotes usage-based OpenAI API access", () => {
		const providers = getOAuthProviders();
		expect(providers.find(provider => provider.id === "openai-codex")).toBeUndefined();
		expect(providers.find(provider => provider.id === "openai")?.name).toBe(
			"OpenAI Responses API (usage-based API access)",
		);
	});

	test("disables legacy credentials without deleting them or attempting a refresh", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-openai-codex-removal-"));
		const dbPath = path.join(tempDir, "agent.db");
		const legacy = await AuthCredentialStore.open(dbPath);
		legacy.saveOAuth("openai-codex", {
			access: "legacy-access",
			refresh: "legacy-refresh",
			expires: 0,
			accountId: "acct-legacy",
		});
		legacy.close();

		const fetchSpy = vi.fn(() => Promise.reject(new Error("network must not be used")));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		try {
			const store = await AuthCredentialStore.open(dbPath);
			const auth = new AuthStorage(store);
			expect(store.listAuthCredentials("openai-codex")).toEqual([]);
			expect(store.listDisabledAuthCredentials("openai-codex")).toHaveLength(1);
			expect(await auth.getApiKey("openai-codex")).toBeUndefined();
			expect(fetchSpy).not.toHaveBeenCalled();
			auth.close();
		} finally {
			globalThis.fetch = originalFetch;
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("contains no Codex OAuth endpoints, client IDs, or originator fields", async () => {
		const oauthDirectory = path.resolve(import.meta.dir, "../src/utils/oauth");
		const files = await fs.readdir(oauthDirectory);
		const source = await Promise.all(
			files.filter(file => file.endsWith(".ts")).map(file => fs.readFile(path.join(oauthDirectory, file), "utf8")),
		);
		const combined = source.join("\n");
		expect(combined).not.toContain("auth.openai.com/oauth");
		expect(combined).not.toContain("originator");
		expect(combined).not.toContain("app_EMoamEEZ73f0CkXaXp7hrann");
	});

	test("discovers an OpenAI API key and selects the standard Responses provider", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-openai-api-key-"));
		const dbPath = path.join(tempDir, "agent.db");
		const store = await AuthCredentialStore.open(dbPath);
		const auth = new AuthStorage(store);
		await auth.set("openai", { type: "api_key", key: "sk-platform-test" });
		expect(await auth.getApiKey("openai")).toBe("sk-platform-test");

		const originalFetch = globalThis.fetch;
		const requests: Array<{ url: string; authorization: string | null }> = [];
		globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({
				url: input instanceof Request ? input.url : typeof input === "string" ? input : input.toString(),
				authorization:
					input instanceof Request
						? input.headers.get("Authorization")
						: new Headers(init?.headers).get("Authorization"),
			});
			return new Response(JSON.stringify({ error: { message: "mocked response" } }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;
		try {
			const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
			const result = await streamOpenAIResponses(model, testContext, {
				apiKey: await auth.getApiKey("openai"),
			}).result();
			expect(result.stopReason).toBe("error");
			expect(requests).toEqual([
				{ url: "https://api.openai.com/v1/responses", authorization: "Bearer sk-platform-test" },
			]);
		} finally {
			globalThis.fetch = originalFetch;
			auth.close();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
