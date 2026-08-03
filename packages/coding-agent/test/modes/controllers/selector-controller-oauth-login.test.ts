import { beforeAll, describe, expect, it, vi } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { OAuthManualInputManager } from "../../../src/modes/oauth-manual-input";
import { initTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(() => {
	initTheme();
});

describe("SelectorController Google Antigravity login", () => {
	it("persists and reports Gemini 3.6 Flash High after OAuth succeeds", async () => {
		const model = {
			id: "gemini-3.6-flash-high",
			provider: "google-antigravity",
		};
		const addedComponents: Array<{ render(width: number): string[] }> = [];
		const login = vi.fn(async () => undefined);
		const refresh = vi.fn(async () => undefined);
		const setModel = vi.fn(async () => undefined);
		const setThinkingLevel = vi.fn();
		const invalidate = vi.fn();
		const updateEditorBorderColor = vi.fn();
		const showError = vi.fn();
		const ctx = {
			session: {
				modelRegistry: {
					authStorage: { login },
					refresh,
					getAll: () => [model],
				},
				setModel,
				setThinkingLevel,
			},
			oauthManualInput: new OAuthManualInputManager(),
			statusLine: { invalidate },
			updateEditorBorderColor,
			chatContainer: {
				addChild: (component: { render(width: number): string[] }) => addedComponents.push(component),
			},
			ui: { requestRender: vi.fn() },
			showStatus: vi.fn(),
			showError,
			openInBrowser: vi.fn(),
		} as unknown as InteractiveModeContext;

		await new SelectorController(ctx).showOAuthSelector("login", "google-antigravity");

		expect(login).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(setModel.mock.invocationCallOrder[0]);
		expect(setModel).toHaveBeenCalledWith(model, "default", {
			selector: "google-antigravity/gemini-3.6-flash-high",
			thinkingLevel: ThinkingLevel.High,
		});
		expect(setThinkingLevel).toHaveBeenCalledWith(ThinkingLevel.High);
		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(updateEditorBorderColor).toHaveBeenCalledTimes(1);
		expect(showError).not.toHaveBeenCalled();

		const rendered = addedComponents.flatMap(component => component.render(120)).join("\n");
		expect(rendered).toContain("Successfully logged in to google-antigravity");
		expect(rendered).toContain("Default model: google-antigravity/gemini-3.6-flash-high");
	});
});
