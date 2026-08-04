import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { getAgentDir, setAgentDir } from "@f5-sales-demo/pi-utils";
import { VLLM_DEFAULT_TOOL_NAMES } from "../../../src/config/vllm-config";
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

const originalAgentDir = getAgentDir();
let tempAgentDir: string;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(() => {
	tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-vllm-controller-"));
	setAgentDir(tempAgentDir);
});

afterEach(() => {
	server?.stop(true);
	server = undefined;
	setAgentDir(originalAgentDir);
	fs.rmSync(tempAgentDir, { recursive: true, force: true });
});

function createVllmContext(
	endpoint: string,
	apiKey: string,
	model: { id: string; provider: string; name: string },
	existingApiKey?: string,
) {
	const addedComponents: Array<{ render(width: number): string[] }> = [];
	let storedCredential: { type: "api_key"; key: string } | undefined = existingApiKey
		? { type: "api_key", key: existingApiKey }
		: undefined;
	let promptIndex = 0;
	const login = vi.fn(async () => undefined);
	const get = vi.fn(() => storedCredential);
	const set = vi.fn(async (_provider: string, credential: { type: "api_key"; key: string }) => {
		storedCredential = credential;
	});
	const remove = vi.fn(async () => {
		storedCredential = undefined;
	});
	const logout = vi.fn(async () => {
		storedCredential = undefined;
	});
	const refreshProvider = vi.fn(async () => undefined);
	const setModel = vi.fn(async () => undefined);
	const setThinkingLevel = vi.fn();
	const setActiveToolsByName = vi.fn(async () => undefined);
	const showError = vi.fn();
	const openInBrowser = vi.fn();
	const editor = {};
	const ctx = {
		session: {
			modelRegistry: {
				authStorage: { get, set, remove, login, logout },
				refreshProvider,
				getAll: () => [model],
			},
			setModel,
			setThinkingLevel,
			setActiveToolsByName,
		},
		oauthManualInput: new OAuthManualInputManager(),
		statusLine: { invalidate: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		chatContainer: {
			addChild: (component: { render(width: number): string[] }) => addedComponents.push(component),
		},
		editor,
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
		ui: {
			requestRender: vi.fn(),
			setFocus: (focus: { setValue?: (value: string) => void; onSubmit?: () => void }) => {
				if (!focus?.setValue || !focus.onSubmit) return;
				const value = promptIndex++ === 0 ? endpoint : apiKey;
				queueMicrotask(() => {
					focus.setValue?.(value);
					focus.onSubmit?.();
				});
			},
		},
		showStatus: vi.fn(),
		showError,
		openInBrowser,
	} as unknown as InteractiveModeContext;

	return {
		ctx,
		addedComponents,
		login,
		set,
		remove,
		logout,
		refreshProvider,
		setModel,
		setThinkingLevel,
		setActiveToolsByName,
		showError,
		openInBrowser,
	};
}

describe("SelectorController vLLM login", () => {
	it("probes, persists, refreshes only vLLM, and auto-selects one model", async () => {
		const authorizations: string[] = [];
		server = Bun.serve({
			port: 0,
			fetch: request => {
				authorizations.push(request.headers.get("Authorization") ?? "");
				return Response.json({ data: [{ id: "local-tool-model" }] });
			},
		});
		const endpoint = new URL("v1", server.url).toString().replace(/\/$/, "");
		const model = { id: "local-tool-model", provider: "vllm", name: "Local Tool Model" };
		const harness = createVllmContext(endpoint, "test-secret", model);

		await new SelectorController(harness.ctx).showOAuthSelector("login", "vllm");

		expect(authorizations).toEqual(["Bearer test-secret"]);
		expect(harness.login).not.toHaveBeenCalled();
		expect(harness.set).toHaveBeenCalledWith("vllm", { type: "api_key", key: "test-secret" });
		expect(harness.remove).not.toHaveBeenCalled();
		expect(harness.refreshProvider).toHaveBeenCalledWith("vllm", "online");
		expect(harness.setModel).toHaveBeenCalledWith(model, "default", {
			selector: "vllm/local-tool-model",
			thinkingLevel: ThinkingLevel.Off,
		});
		expect(harness.setThinkingLevel).toHaveBeenCalledWith(ThinkingLevel.Off);
		expect(harness.setActiveToolsByName).toHaveBeenCalledWith([...VLLM_DEFAULT_TOOL_NAMES]);
		expect(harness.openInBrowser).not.toHaveBeenCalled();
		expect(harness.showError).not.toHaveBeenCalled();

		const content = fs.readFileSync(path.join(tempAgentDir, "models.yml"), "utf8");
		expect(content).toContain(`baseUrl: ${endpoint}`);
		expect(content).not.toContain("test-secret");
		const rendered = harness.addedComponents.flatMap(component => component.render(120)).join("\n");
		expect(rendered).toContain("Successfully logged in to vllm");
		expect(rendered).toContain("Default model: vllm/local-tool-model");
	});

	it("does not mutate credentials or config when the model probe fails", async () => {
		server = Bun.serve({ port: 0, fetch: () => new Response("unavailable", { status: 503 }) });
		const endpoint = new URL("v1", server.url).toString().replace(/\/$/, "");
		const harness = createVllmContext(endpoint, "test-secret", {
			id: "local-tool-model",
			provider: "vllm",
			name: "Local Tool Model",
		});

		await new SelectorController(harness.ctx).showOAuthSelector("login", "vllm");

		expect(harness.set).not.toHaveBeenCalled();
		expect(harness.remove).not.toHaveBeenCalled();
		expect(harness.refreshProvider).not.toHaveBeenCalled();
		expect(harness.setModel).not.toHaveBeenCalled();
		expect(fs.existsSync(path.join(tempAgentDir, "models.yml"))).toBe(false);
		expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining("HTTP 503"));
	});

	it("restores the previous credential when endpoint persistence fails", async () => {
		server = Bun.serve({
			port: 0,
			fetch: () => {
				fs.mkdirSync(path.join(tempAgentDir, "models.yml"));
				return Response.json({ data: [{ id: "local-tool-model" }] });
			},
		});
		const endpoint = new URL("v1", server.url).toString().replace(/\/$/, "");
		const harness = createVllmContext(
			endpoint,
			"replacement-key",
			{ id: "local-tool-model", provider: "vllm", name: "Local Tool Model" },
			"previous-key",
		);

		await new SelectorController(harness.ctx).showOAuthSelector("login", "vllm");

		expect(harness.set).toHaveBeenNthCalledWith(1, "vllm", {
			type: "api_key",
			key: "replacement-key",
		});
		expect(harness.set).toHaveBeenNthCalledWith(2, "vllm", {
			type: "api_key",
			key: "previous-key",
		});
		expect(harness.refreshProvider).not.toHaveBeenCalled();
		expect(harness.showError).toHaveBeenCalled();
	});

	it("removes only the credential on logout and keeps the endpoint configuration", async () => {
		const endpoint = "http://127.0.0.1:8000/v1";
		const modelsPath = path.join(tempAgentDir, "models.yml");
		const originalConfig = `providers:\n  vllm:\n    baseUrl: ${endpoint}\n`;
		fs.writeFileSync(modelsPath, originalConfig);
		const harness = createVllmContext(endpoint, "", {
			id: "local-tool-model",
			provider: "vllm",
			name: "Local Tool Model",
		});

		await new SelectorController(harness.ctx).showOAuthSelector("logout", "vllm");

		expect(harness.logout).toHaveBeenCalledWith("vllm");
		expect(harness.refreshProvider).toHaveBeenCalledWith("vllm", "online");
		expect(fs.readFileSync(modelsPath, "utf8")).toBe(originalConfig);
	});
});
