import { beforeAll, describe, expect, it, vi } from "bun:test";
import { getOAuthProviders } from "@f5-sales-demo/pi-ai";
import { getLoginOptions } from "../src/modes/controllers/login-options";
import { SelectorController } from "../src/modes/controllers/selector-controller";
import { shouldAutoLaunchProviderLogin } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";

beforeAll(() => {
	initTheme();
});

describe("first-run provider onboarding", () => {
	it("does not replace an explicit failed --model selection with the login picker", () => {
		expect(shouldAutoLaunchProviderLogin(true, "launch-flag")).toBe(false);
		expect(shouldAutoLaunchProviderLogin(true, "config")).toBe(true);
		expect(shouldAutoLaunchProviderLogin(false, "config")).toBe(false);
	});

	it("opens the compact shared provider selector instead of the full catalog", async () => {
		const children: Array<{ render?(width: number): string[] }> = [];
		const editor = { render: () => [] };
		const ctx = {
			editor,
			editorContainer: {
				clear: () => children.splice(0),
				addChild: (component: { render?(width: number): string[] }) => children.push(component),
			},
			ui: {
				setFocus: vi.fn(),
				requestRender: vi.fn(),
			},
			session: {
				sessionId: "first-run",
				modelRegistry: {
					authStorage: { has: () => false, hasAuth: () => false },
					getApiKeyForProvider: async () => undefined,
					getProviderInventory: () => [],
					getConfiguredProviderIds: () => new Set(),
					getProviderAccessState: (provider: string) => ({
						provider,
						configured: false,
						status: "unconfigured",
						catalogFreshness: "none",
						selectable: false,
					}),
					getProviderPickerMetadata: () => undefined,
				},
			},
		} as unknown as InteractiveModeContext;

		void new SelectorController(ctx).showFirstRunLogin();
		await Bun.sleep(0);

		const rendered = Bun.stripANSI(children.flatMap(component => component.render?.(120) ?? []).join("\n"));
		expect(rendered).toContain("Select provider to login");
		expect(rendered).toContain("No providers configured");
		expect(rendered).toContain("Add provider…");
		expect(rendered).not.toContain("Google Cloud Vertex AI (Corporate)");
		expect(rendered).not.toContain("ChatGPT Plus/Pro (Codex Subscription)");
		const enterprise = getOAuthProviders().find(provider => provider.id === "google-antigravity-enterprise");
		expect(getOAuthProviders().some(provider => provider.id === "google-vertex")).toBe(false);
		expect(getLoginOptions()[0]).toMatchObject({ id: "google-vertex", kind: "local" });
		expect(enterprise?.name).toBe("Google Antigravity Enterprise (Advanced OAuth)");
		expect(enterprise?.description).toContain("not Vertex ADC");
		expect(rendered).not.toContain("Model Provider URL");
	});
});
