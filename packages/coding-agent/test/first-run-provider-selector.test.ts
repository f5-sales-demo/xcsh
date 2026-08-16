import { beforeAll, describe, expect, it, vi } from "bun:test";
import { SelectorController } from "../src/modes/controllers/selector-controller";
import { initTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";

beforeAll(() => {
	initTheme();
});

describe("first-run provider onboarding", () => {
	it("opens the shared provider selector instead of entering LiteLLM URL configuration", async () => {
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
					authStorage: { hasAuth: () => false },
					getApiKeyForProvider: async () => undefined,
				},
			},
		} as unknown as InteractiveModeContext;

		void new SelectorController(ctx).showFirstRunLogin();
		await Bun.sleep(0);

		const rendered = Bun.stripANSI(children.flatMap(component => component.render?.(120) ?? []).join("\n"));
		expect(rendered).toContain("Select provider to login");
		expect(rendered).toContain("ChatGPT Plus/Pro (Codex Subscription)");
		expect(rendered).toContain("OpenAI Responses API (usage-based API access)");
		expect(rendered).not.toContain("Model Provider URL");
	});
});
