import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage } from "../src/auth-storage";

describe("AuthStorage non-OAuth API key resolution", () => {
	let directory = "";
	let store: AuthCredentialStore;
	let storage: AuthStorage;
	let previousOpenAIKey: string | undefined;

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-auth-non-oauth-"));
		store = await AuthCredentialStore.open(path.join(directory, "agent.db"));
		storage = new AuthStorage(store, { configValueResolver: async value => `resolved:${value}` });
		previousOpenAIKey = process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY;
	});

	afterEach(async () => {
		store.close();
		if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = previousOpenAIKey;
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("uses runtime, stored, environment, then configuration without an OAuth lookup", async () => {
		storage.setFallbackResolver(provider => (provider === "openai" ? "configured-key" : undefined));
		process.env.OPENAI_API_KEY = "environment-key";
		await storage.set("openai", { type: "api_key", key: "stored-reference" });
		storage.setRuntimeApiKey("openai", "runtime-key");

		expect(await storage.getApiKeyFromNonOAuthSources("openai", "fixture-session")).toBe("runtime-key");
		storage.removeRuntimeApiKey("openai");
		expect(await storage.getApiKeyFromNonOAuthSources("openai", "fixture-session")).toBe("resolved:stored-reference");
		await storage.remove("openai");
		expect(await storage.getApiKeyFromNonOAuthSources("openai", "fixture-session")).toBe("environment-key");
		delete process.env.OPENAI_API_KEY;
		expect(await storage.getApiKeyFromNonOAuthSources("openai", "fixture-session")).toBe("configured-key");
	});

	it("does not return or refresh an OAuth credential", async () => {
		await storage.set("openai", {
			type: "oauth",
			access: "oauth-access-token",
			refresh: "oauth-refresh-token",
			expires: Date.now() - 60_000,
		});

		expect(await storage.getApiKeyFromNonOAuthSources("openai", "fixture-session")).toBeUndefined();
		expect(storage.getOAuthCredential("openai")?.access).toBe("oauth-access-token");
	});
});
