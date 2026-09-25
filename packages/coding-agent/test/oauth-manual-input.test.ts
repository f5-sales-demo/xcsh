import { describe, expect, it } from "bun:test";
import { OAuthManualInputManager } from "../src/modes/oauth-manual-input";

describe("OAuthManualInputManager", () => {
	it("keeps only the current pending authorization URL for exact recovery copy", async () => {
		const manager = new OAuthManualInputManager();
		const url = "https://login.example.test/authorize?state=synthetic-state&code_challenge=synthetic-challenge";
		manager.setAuthorizationUrl("google-vertex", url);
		const pending = manager.waitForInput("google-vertex");
		expect(manager.authorizationUrl).toBe(url);
		manager.submit("synthetic-code");
		expect(await pending).toBe("synthetic-code");
		expect(manager.authorizationUrl).toBeUndefined();
	});

	it("resolves waitForInput with submitted value", async () => {
		const manager = new OAuthManualInputManager();
		const promise = manager.waitForInput("openai-codex");

		const submitted = manager.submit("callback-url");

		expect(submitted).toBe(true);
		expect(await promise).toBe("callback-url");
		expect(manager.hasPending()).toBe(false);
	});

	it("returns false when no pending input", () => {
		const manager = new OAuthManualInputManager();

		expect(manager.submit("callback-url")).toBe(false);
	});

	it("clears pending input and rejects promise", async () => {
		const manager = new OAuthManualInputManager();
		const promise = manager.waitForInput("anthropic");

		manager.clear();

		await expect(promise).rejects.toThrow("Manual OAuth input cleared");
		expect(manager.submit("late-url")).toBe(false);
	});
});
