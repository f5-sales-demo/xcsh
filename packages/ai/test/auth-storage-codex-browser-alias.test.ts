import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage } from "../src/auth-storage";
import * as openAICodexModule from "../src/utils/oauth/openai-codex";

const CREDENTIALS = {
	refresh: "refresh-token",
	access: "access-token",
	expires: Date.now() + 60_000,
	accountId: "chatgpt-account",
	email: "developer@example.com",
};

describe("AuthStorage OpenAI Codex browser alias", () => {
	let temporaryDirectory = "";
	let store: AuthCredentialStore | undefined;
	let authStorage: AuthStorage | undefined;

	beforeEach(async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-codex-browser-"));
		store = await AuthCredentialStore.open(path.join(temporaryDirectory, "agent.db"));
		authStorage = new AuthStorage(store);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = undefined;
		authStorage = undefined;
		if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
	});

	it("forces browser PKCE and persists credentials under the canonical provider", async () => {
		if (!authStorage || !store) throw new Error("test setup failed");
		const login = vi.spyOn(openAICodexModule, "loginOpenAICodex").mockResolvedValue(CREDENTIALS);

		await authStorage.login("openai-codex-browser", { onAuth: () => {}, onPrompt: async () => "" });

		expect(login).toHaveBeenCalledWith(expect.objectContaining({ method: "browser" }));
		expect(store.listAuthCredentials("openai-codex")).toHaveLength(1);
		expect(store.listAuthCredentials("openai-codex-browser")).toHaveLength(0);
		expect(authStorage.hasAuth("openai-codex-browser")).toBe(true);
	});
});
