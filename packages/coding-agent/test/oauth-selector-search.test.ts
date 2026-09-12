import { beforeAll, describe, expect, it, vi } from "bun:test";
import { getOAuthProviders } from "@f5-sales-demo/pi-ai";
import { OAuthSelectorComponent } from "../src/modes/components/oauth-selector";
import {
	ADD_PROVIDER_ID,
	buildProviderManagementOptions,
	getLoginOptions,
} from "../src/modes/controllers/login-options";
import { initTheme } from "../src/modes/theme/theme";
import type { AuthStorage } from "../src/session/auth-storage";

beforeAll(() => {
	initTheme();
});

function createSelector(
	mode: "login" | "logout" = "login",
	authenticated = false,
	options?: ConstructorParameters<typeof OAuthSelectorComponent>[4],
) {
	const onSelect = vi.fn();
	const onCancel = vi.fn();
	const authStorage = {
		hasAuth: (provider: string) =>
			authenticated && (provider === "google-antigravity" || provider === "openai-codex"),
		has: (provider: string) => authenticated && (provider === "google-antigravity" || provider === "openai-codex"),
	} as unknown as AuthStorage;
	const selector = new OAuthSelectorComponent(mode, authStorage, onSelect, onCancel, options);
	return { selector, onSelect, onCancel };
}

function renderText(selector: OAuthSelectorComponent): string {
	return Bun.stripANSI(selector.render(100).join("\n"));
}

describe("OAuthSelectorComponent provider search", () => {
	it("exposes exactly one canonical ChatGPT provider", () => {
		expect(getOAuthProviders().filter(provider => provider.id.startsWith("openai-codex"))).toEqual([
			expect.objectContaining({ id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)" }),
		]);
		const selector = createSelector("login", true).selector;
		for (const character of "openai-codex") selector.handleInput(character);
		const rendered = renderText(selector);
		expect(rendered).toContain("ChatGPT");
		expect(rendered).not.toContain("ChatGPT Plus/Pro (Browser callback)");
		expect(rendered).toContain("Credentials saved");
	});

	it("renders honest normalized access and picker-scope labels", () => {
		const selector = createSelector("login", false, {
			getAccessState: provider => ({
				provider,
				configured: true,
				credentialSource: provider === "vllm" ? "keyless" : "stored-oauth",
				status: provider === "anthropic" ? "reauth-required" : "configured-unverified",
				catalogFreshness: "none",
				selectable: false,
			}),
			isExcluded: provider => provider === "anthropic",
		}).selector;
		for (const character of "anthropic") selector.handleInput(character);
		const rendered = renderText(selector);
		expect(rendered).toContain("Sign-in required");
		expect(rendered).not.toContain("excluded from picker");
		expect(rendered).not.toContain("logged in");
	});

	it("identifies keyless providers without calling them logged in", () => {
		const selector = createSelector("login", false, {
			getAccessState: provider => ({
				provider,
				configured: provider === "vllm",
				credentialSource: provider === "vllm" ? "keyless" : undefined,
				status: provider === "vllm" ? "configured-unverified" : "unconfigured",
				catalogFreshness: "none",
				selectable: provider === "vllm",
			}),
		}).selector;
		for (const character of "vllm") selector.handleInput(character);
		const rendered = renderText(selector);
		expect(rendered).toContain("Credentials saved");
		expect(rendered).not.toContain("logged in");
	});

	it("renders an explicitly configured keyless provider as available after successful validation", async () => {
		const selector = createSelector("login", false, {
			getAccessState: provider => ({
				provider,
				configured: provider === "vllm",
				credentialSource: provider === "vllm" ? "keyless" : undefined,
				status: provider === "vllm" ? "connected" : "unconfigured",
				catalogFreshness: provider === "vllm" ? "fresh" : "none",
				selectable: provider === "vllm",
			}),
			validateAccess: async provider => ({
				provider,
				configured: true,
				credentialSource: "keyless",
				status: "connected",
				catalogFreshness: "fresh",
				selectable: true,
			}),
		}).selector;
		for (const character of "vllm") selector.handleInput(character);
		await Bun.sleep(0);

		const rendered = renderText(selector);
		expect(rendered).toContain("Ready");
		expect(rendered).not.toContain("Connected");
		expect(rendered).not.toContain("logged in");
	});

	it("reports an unreachable keyless provider instead of claiming it is configured", async () => {
		const selector = createSelector("login", false, {
			getAccessState: provider => ({
				provider,
				configured: true,
				credentialSource: provider === "vllm" ? "keyless" : undefined,
				status: provider === "vllm" ? "unreachable" : "unconfigured",
				catalogFreshness: "none",
				selectable: false,
			}),
		}).selector;
		for (const character of "vllm") selector.handleInput(character);

		const rendered = renderText(selector);
		expect(rendered).toContain("Unreachable");
		expect(rendered).not.toContain("Credentials saved");
		expect(rendered).not.toContain(" connected");
		expect(rendered).not.toContain("logged in");
	});

	it("shows only relevant providers plus Add provider in the default login view", () => {
		const providers = buildProviderManagementOptions({
			mode: "login",
			providerInventory: ["anthropic", "github-copilot"],
			configuredProviderIds: [],
			providerAllowlist: [],
			excludedProviderIds: ["github-copilot"],
			getAccessState: provider => ({
				provider,
				configured: provider === "anthropic" || provider === "github-copilot",
				credentialSource: provider === "anthropic" || provider === "github-copilot" ? "stored-oauth" : undefined,
				status: provider === "anthropic" || provider === "github-copilot" ? "connected" : "unconfigured",
				catalogFreshness: provider === "anthropic" || provider === "github-copilot" ? "fresh" : "none",
				selectable: provider === "anthropic" || provider === "github-copilot",
			}),
			getPickerMetadata: () => undefined,
			hasStoredCredential: provider => provider === "anthropic" || provider === "github-copilot",
		});
		const { selector } = createSelector("login", false, {
			providers,
			catalogProviders: getLoginOptions(),
			getAccessState: provider => ({
				provider,
				configured: provider === "anthropic",
				credentialSource: provider === "anthropic" ? "stored-oauth" : undefined,
				status: provider === "anthropic" ? "connected" : "unconfigured",
				catalogFreshness: provider === "anthropic" ? "fresh" : "none",
				selectable: provider === "anthropic",
			}),
		});

		const rendered = renderText(selector);
		expect(rendered).toContain("Anthropic");
		expect(rendered).toContain("Add provider…");
		expect(rendered).not.toContain("GitHub Copilot");
		expect(rendered).not.toContain("LM Studio");
		expect(rendered).not.toContain("Ollama");

		selector.handleInput("\x1b[B");
		selector.handleInput("\n");
		for (const character of "lm-studio") selector.handleInput(character);
		expect(renderText(selector)).toContain("LM Studio");
	});

	it("opens a searchable catalog when no connections exist", () => {
		const providers = buildProviderManagementOptions({
			mode: "login",
			providerInventory: [],
			configuredProviderIds: [],
			providerAllowlist: [],
			getAccessState: provider => ({
				provider,
				configured: false,
				status: "unconfigured",
				catalogFreshness: "none",
				selectable: false,
			}),
			getPickerMetadata: () => undefined,
			hasStoredCredential: () => false,
		});
		const { selector } = createSelector("login", false, { providers });
		const rendered = renderText(selector);
		expect(rendered).toContain("Connect a provider");
		expect(rendered).toContain("Subscriptions");
		expect(rendered).not.toContain("LM Studio");
		expect(rendered).not.toContain("Ollama");
	});

	it("groups related transports into one management entry and renders sanitized details", () => {
		const providers = buildProviderManagementOptions({
			mode: "login",
			providerInventory: ["litellm", "anthropic"],
			configuredProviderIds: ["litellm", "anthropic"],
			providerAllowlist: ["litellm", "anthropic"],
			getAccessState: provider => ({
				provider,
				configured: provider === "litellm" || provider === "anthropic",
				credentialSource: provider === "litellm" || provider === "anthropic" ? "configuration" : undefined,
				status: provider === "litellm" || provider === "anthropic" ? "unreachable" : "unconfigured",
				catalogFreshness: provider === "litellm" || provider === "anthropic" ? "stale" : "none",
				failureReason: provider === "litellm" || provider === "anthropic" ? "401 Bearer [redacted]" : undefined,
				lastCheckedAt: provider === "litellm" || provider === "anthropic" ? 1_788_889_600_000 : undefined,
				selectable: false,
			}),
			getPickerMetadata: provider =>
				provider === "litellm" || provider === "anthropic"
					? { groupId: "litellm", groupLabel: "LiteLLM" }
					: undefined,
			hasStoredCredential: () => false,
		});
		expect(providers.filter(provider => provider.id !== ADD_PROVIDER_ID)).toEqual([
			expect.objectContaining({ id: "litellm", name: "LiteLLM", providerIds: ["litellm", "anthropic"] }),
		]);

		const { selector } = createSelector("login", false, {
			providers,
			getAccessState: provider => ({
				provider,
				configured: true,
				credentialSource: "configuration",
				status: "unreachable",
				catalogFreshness: "stale",
				failureReason: "401 Bearer [redacted]",
				lastCheckedAt: 1_788_889_600_000,
				selectable: false,
			}),
			isExcluded: provider => provider === "anthropic",
		});
		selector.handleInput("\x1b[C");
		const details = renderText(selector);
		expect(details).toContain("Manage LiteLLM");
		expect(details).toContain("Local / proxy");
		expect(details).toContain("Unreachable");
		expect(details).toContain("401 Bearer [redacted]");
		expect(providers[0]?.providerIds).toEqual(["litellm", "anthropic"]);
	});

	it("surfaces a failed route on a grouped management entry", () => {
		const { selector } = createSelector("login", false, {
			providers: [
				{
					id: "litellm",
					kind: "local",
					name: "LiteLLM",
					available: true,
					providerIds: ["litellm", "anthropic"],
				},
			],
			getAccessState: provider => ({
				provider,
				configured: true,
				credentialSource: "configuration",
				status: provider === "litellm" ? "connected" : "unreachable",
				catalogFreshness: provider === "litellm" ? "fresh" : "stale",
				selectable: provider === "litellm",
			}),
		});

		expect(renderText(selector)).toContain("Unreachable");
		expect(renderText(selector)).not.toContain("Connected");
	});

	it("limits logout to providers with removable stored credentials", () => {
		const providers = buildProviderManagementOptions({
			mode: "logout",
			providerInventory: ["anthropic", "openai", "vllm"],
			configuredProviderIds: ["vllm"],
			providerAllowlist: [],
			getAccessState: () => undefined,
			getPickerMetadata: () => undefined,
			hasStoredCredential: provider => provider === "anthropic",
		});
		expect(providers.map(provider => provider.id)).toEqual(["anthropic"]);
	});

	it("keeps custom configured providers manageable without starting an unknown OAuth flow", () => {
		const providers = buildProviderManagementOptions({
			mode: "login",
			providerInventory: ["private-gateway"],
			configuredProviderIds: ["private-gateway"],
			providerAllowlist: [],
			getAccessState: provider => ({
				provider,
				configured: provider === "private-gateway",
				credentialSource: provider === "private-gateway" ? "configuration" : undefined,
				status: provider === "private-gateway" ? "configured-unverified" : "unconfigured",
				catalogFreshness: "none",
				selectable: provider === "private-gateway",
			}),
			getPickerMetadata: () => undefined,
			hasStoredCredential: () => false,
		});
		expect(providers[0]).toMatchObject({ id: "private-gateway", action: "manage-only" });

		const { selector, onSelect } = createSelector("login", false, {
			providers,
			getAccessState: provider => ({
				provider,
				configured: true,
				credentialSource: "configuration",
				status: "configured-unverified",
				catalogFreshness: "none",
				selectable: true,
			}),
		});
		selector.handleInput("\n");
		expect(renderText(selector)).toContain("Manage private-gateway");
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("renders a bounded provider viewport with position and input guidance", () => {
		const { selector } = createSelector();
		const providerCount = getLoginOptions().length;
		const rendered = renderText(selector);

		expect(rendered).toContain(`Search providers (1/${providerCount})`);
		expect(rendered).toContain("Search providers");
		expect(rendered).not.toContain("Enter: select");
		expect(rendered).toContain("Subscriptions");
	});

	it("filters by provider name or ID and selects from only the visible matches", () => {
		const { selector, onSelect } = createSelector();

		for (const character of "openai-codex") selector.handleInput(character);

		const rendered = renderText(selector);
		expect(rendered).toContain("ChatGPT");
		expect(rendered).not.toContain("ChatGPT Plus/Pro (Browser callback)");
		expect(rendered).not.toContain("Anthropic");
		expect(rendered).toContain("Search providers (1/1)");

		selector.handleInput("\n");
		expect(onSelect).toHaveBeenCalledWith("openai-codex");
	});

	it("shows an empty state for unmatched input and does not select", () => {
		const { selector, onSelect } = createSelector();

		for (const character of "no-such-provider") selector.handleInput(character);

		expect(renderText(selector)).toContain("No matching providers");
		selector.handleInput("\n");
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("clears a non-empty filter before Escape cancels the selector", () => {
		const { selector, onCancel } = createSelector();
		for (const character of "litellm") selector.handleInput(character);

		selector.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();
		expect(renderText(selector)).toContain(`Search providers (1/${getLoginOptions().length})`);

		selector.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("keeps the selected row visible when navigating beyond the first page", () => {
		const { selector } = createSelector();
		for (let index = 0; index < 11; index += 1) selector.handleInput("\x1b[B");

		const rendered = renderText(selector);
		expect(rendered).not.toContain("Enter: select");
		expect(rendered).not.toContain("Anthropic");
		expect(rendered).toContain(`Search providers (12/${getLoginOptions().length})`);
	});

	it("keeps generic and Enterprise Antigravity credentials as distinct routes", () => {
		const login = createSelector("login", true).selector;
		for (const character of "google-antigravity-enterprise") login.handleInput(character);
		expect(renderText(login)).toContain("Google Antigravity Enterprise");

		const logout = createSelector("logout", true).selector;
		for (const character of "antigravity") logout.handleInput(character);
		const rendered = renderText(logout);
		expect(rendered).toContain("Antigravity");
		expect(rendered).toContain("Google Antigravity Enterprise");
		expect(rendered).toContain("Search providers (1/2)");
	});
});
