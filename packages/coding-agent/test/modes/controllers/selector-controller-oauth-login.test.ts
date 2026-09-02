import { beforeAll, describe, expect, it, vi } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { OAuthManualInputManager } from "../../../src/modes/oauth-manual-input";
import { initTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

const LONG_AUTH_URL =
	"https://login.example.test/authorize?client_id=synthetic-client&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback&scope=openid%20profile&state=synthetic-state&code_challenge=synthetic-challenge";

function renderVisible(components: Array<{ render(width: number): string[] }>, width = 40): string {
	return Bun.stripANSI(components.flatMap(component => component.render(width)).join("\n"))
		.replace(/\s+/g, " ")
		.trim();
}

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

	it("presents the shared short link, instructions, browser policy, and manual pairing", async () => {
		const model = { id: "gemini-3.6-flash-high", provider: "google-antigravity" };
		const addedComponents: Array<{ render(width: number): string[] }> = [];
		const manualInput = new OAuthManualInputManager();
		const openInBrowser = vi.fn();
		const login = vi.fn(async (_provider, callbacks) => {
			callbacks.onAuth({ url: LONG_AUTH_URL, instructions: "Finish the provider instructions." });
			expect(callbacks.onManualCodeInput).toBeDefined();
			const redirect = callbacks.onManualCodeInput();
			expect(manualInput.submit("http://localhost/callback?code=synthetic&state=valid")).toBe(true);
			await expect(redirect).resolves.toContain("code=synthetic");
		});
		const ctx = {
			session: {
				modelRegistry: { authStorage: { login }, refresh: vi.fn(async () => undefined), getAll: () => [model] },
				setModel: vi.fn(async () => undefined),
				setThinkingLevel: vi.fn(),
			},
			oauthManualInput: manualInput,
			statusLine: { invalidate: vi.fn() },
			updateEditorBorderColor: vi.fn(),
			chatContainer: {
				addChild: (component: { render(width: number): string[] }) => addedComponents.push(component),
			},
			ui: { requestRender: vi.fn() },
			showStatus: vi.fn(),
			showError: vi.fn(),
			openInBrowser,
		} as unknown as InteractiveModeContext;

		await new SelectorController(ctx).showOAuthSelector("login", "google-antigravity");

		const visible = renderVisible(addedComponents);
		expect(visible).toContain("Open sign-in page");
		expect(visible).toContain(process.platform === "darwin" ? "Cmd+click to open" : "Ctrl+click to open");
		expect(visible).toContain("Finish the provider instructions.");
		expect(visible).toContain("Tip: You can complete pairing with /login <redirect URL>.");
		expect(visible).not.toContain(LONG_AUTH_URL);
		expect(openInBrowser).toHaveBeenCalledTimes(1);
		expect(openInBrowser).toHaveBeenCalledWith(LONG_AUTH_URL);
	});
});

describe("SelectorController Corporate Vertex login", () => {
	it("shows the shared link and manual-code guidance without opening a browser when headless", async () => {
		const previousSshConnection = process.env.SSH_CONNECTION;
		process.env.SSH_CONNECTION = "synthetic-client synthetic-server";
		try {
			const addedComponents: Array<{ render(width: number): string[] }> = [];
			const openInBrowser = vi.fn();
			const login = vi.fn(async (_provider, callbacks) => {
				callbacks.onAuth({ url: LONG_AUTH_URL });
				throw new Error("stop after presentation");
			});
			const ctx = {
				session: { modelRegistry: { authStorage: { getApiKey: vi.fn(async () => undefined), login } } },
				oauthManualInput: new OAuthManualInputManager(),
				chatContainer: {
					addChild: (component: { render(width: number): string[] }) => addedComponents.push(component),
				},
				ui: { requestRender: vi.fn() },
				showStatus: vi.fn(),
				showError: vi.fn(),
				openInBrowser,
			} as unknown as InteractiveModeContext;

			await new SelectorController(ctx).showOAuthSelector("login", "google-vertex");

			const visible = renderVisible(addedComponents);
			expect(visible).toContain("Open sign-in page");
			expect(visible).toContain("Tip: After browser sign-in, complete pairing with /login <authorization code>.");
			expect(visible).not.toContain(LONG_AUTH_URL);
			expect(openInBrowser).not.toHaveBeenCalled();
		} finally {
			if (previousSshConnection === undefined) delete process.env.SSH_CONNECTION;
			else process.env.SSH_CONNECTION = previousSshConnection;
		}
	});
});

describe("SelectorController ChatGPT device login", () => {
	it("does not try to open a browser on the remote Ubuntu host", async () => {
		const previousSshConnection = process.env.SSH_CONNECTION;
		process.env.SSH_CONNECTION = "client server";
		try {
			const openInBrowser = vi.fn();
			const manualInput = new OAuthManualInputManager();
			const login = vi.fn(async (_provider, callbacks) => {
				expect(callbacks.onManualCodeInput).toBeDefined();
				callbacks.onAuth({
					url: "https://auth.openai.com/oauth/authorize?state=redacted",
					instructions: "Complete browser login and paste the redirect URL",
				});
				const redirect = callbacks.onManualCodeInput();
				expect(manualInput.submit("http://localhost:1455/auth/callback?code=manual&state=valid")).toBe(true);
				await expect(redirect).resolves.toContain("code=manual");
			});
			const ctx = {
				session: {
					modelRegistry: { authStorage: { login }, refresh: vi.fn(async () => undefined), getAll: () => [] },
				},
				oauthManualInput: manualInput,
				statusLine: { invalidate: vi.fn() },
				updateEditorBorderColor: vi.fn(),
				chatContainer: { addChild: vi.fn() },
				ui: { requestRender: vi.fn() },
				showStatus: vi.fn(),
				showError: vi.fn(),
				openInBrowser,
			} as unknown as InteractiveModeContext;

			await new SelectorController(ctx).showOAuthSelector("login", "openai-codex");

			expect(login).toHaveBeenCalledTimes(1);
			expect(openInBrowser).not.toHaveBeenCalled();
		} finally {
			if (previousSshConnection === undefined) delete process.env.SSH_CONNECTION;
			else process.env.SSH_CONNECTION = previousSshConnection;
		}
	});
});
