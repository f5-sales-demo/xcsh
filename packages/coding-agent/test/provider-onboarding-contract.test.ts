import { beforeAll, expect, test, vi } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import { OAuthSelectorComponent } from "../src/modes/components/oauth-selector";
import { getLoginRecommendation } from "../src/modes/controllers/login-model";
import { getLoginOptions } from "../src/modes/controllers/login-options";
import { initTheme } from "../src/modes/theme/theme";
import type { AuthStorage } from "../src/session/auth-storage";

beforeAll(() => initTheme());
test("empty configuration opens catalog directly and searches access descriptions", () => {
	const selector = new OAuthSelectorComponent(
		"login",
		{ hasAuth: () => false } as unknown as AuthStorage,
		vi.fn(),
		vi.fn(),
		{
			providers: [{ id: "add", name: "Add provider…", kind: "local", available: true, action: "add-provider" }],
			catalogProviders: getLoginOptions(),
		},
	);
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("Connect a provider");
	for (const c of "subscription") selector.handleInput(c);
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("ChatGPT");
	selector.stopValidation();
});
test("recommendation is read-only and requires fresh exact catalog membership", () => {
	const model = { provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" } as Model;
	const registry = {
		getAll: () => [model],
		getProviderDiscoveryState: () => ({ status: "ok", stale: false, models: [model.id] }),
	};
	expect(getLoginRecommendation(registry, "openai-codex")?.modelId).toBe(model.id);
	registry.getProviderDiscoveryState = () => ({ status: "ok", stale: true, models: [model.id] });
	expect(getLoginRecommendation(registry, "openai-codex")).toBeUndefined();
	registry.getProviderDiscoveryState = () => ({ status: "ok", stale: false, models: [] });
	expect(getLoginRecommendation(registry, "openai-codex")).toBeUndefined();
});

test("configured provider selection opens management instead of restarting authentication", () => {
	const authenticate = vi.fn();
	const chooseModel = vi.fn();
	const selector = new OAuthSelectorComponent(
		"login",
		{ hasAuth: () => true } as unknown as AuthStorage,
		authenticate,
		vi.fn(),
		{
			providers: [{ id: "openai-codex", name: "ChatGPT", kind: "oauth", available: true }],
			onChooseModel: chooseModel,
		},
	);
	selector.handleInput("\r");
	const text = Bun.stripANSI(selector.render(80).join("\n"));
	expect(text).toContain("Manage ChatGPT");
	expect(text).toContain("Choose model");
	expect(text).toContain("Sign in again");
	expect(authenticate).not.toHaveBeenCalled();
	selector.handleInput("\r");
	expect(chooseModel).toHaveBeenCalledWith("openai-codex");
	expect(authenticate).not.toHaveBeenCalled();
});
