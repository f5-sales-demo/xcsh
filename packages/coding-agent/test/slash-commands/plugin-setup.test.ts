import { beforeAll, describe, expect, it, vi } from "bun:test";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { locales } from "../../src/locales/index";
import { initTheme } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

registerLocales(locales);
beforeAll(() => initTheme());

describe("/plugin setup", () => {
	it("uses an active session context before opening the guided Platform wizard", async () => {
		const children: unknown[] = [];
		const setFocus = vi.fn();
		const verifyAfterSetup = vi.fn(async () => ({ state: "ready" as const }));
		const plan = {
			pluginDependencies: [],
			requiredEnvironment: ["XCSH_API_URL", "XCSH_API_TOKEN", "XCSH_TENANT"],
			profileFields: [],
			steps: [],
			verification: [],
			guidedAction: { kind: "context_wizard" as const },
		};
		const activeEnvironment = {
			XCSH_API_URL: "https://tenant.example.com",
			XCSH_API_TOKEN: "secret-token",
			XCSH_TENANT: "tenant",
		};
		const showStatus = vi.fn();
		const ctx = {
			editor: { addToHistory: vi.fn(), setText: vi.fn() },
			editorContainer: { clear: vi.fn(), addChild: vi.fn((child: unknown) => children.push(child)) },
			ui: { setFocus, requestRender: vi.fn(), terminal: { rows: 24 } },
			settings: { get: vi.fn((key: string) => (key === "bash.environment" ? activeEnvironment : undefined)) },
			sessionManager: { getCwd: () => "/tmp" },
			session: {
				extensionRunner: {
					getAllRegisteredIntegrations: () => [
						{
							id: "platform",
							name: "F5 Distributed Cloud Platform",
							plugin: "platform",
							setupPlan: plan,
							get: async () => ({ state: "setup_required" as const, reason: "not_authenticated" as const }),
							invalidate: vi.fn(),
							verifyAfterSetup,
						},
					],
				},
			},
			showHookCustom: vi.fn(),
			showStatus,
			showError: vi.fn(),
		} as unknown as InteractiveModeContext;

		expect(await executeBuiltinSlashCommand("/plugin setup platform", { ctx, handleBackgroundCommand() {} })).toBe(
			true,
		);
		expect(verifyAfterSetup).toHaveBeenCalledWith(plan);
		expect(children).toEqual([]);
		expect(setFocus).not.toHaveBeenCalled();
		expect(showStatus).toHaveBeenCalledWith("platform: ready (setup is not required)");
	});

	it("opens the native context wizard for a guided Platform setup without a no-op review", async () => {
		const children: unknown[] = [];
		const setFocus = vi.fn();
		const showHookCustom = vi.fn(() => {
			throw new Error("a native guided setup must not open a generic review");
		});
		const showError = vi.fn();
		const plan = {
			pluginDependencies: [],
			requiredEnvironment: ["XCSH_API_URL", "XCSH_API_TOKEN", "XCSH_TENANT"],
			profileFields: [],
			steps: [],
			verification: [],
			guidedAction: { kind: "context_wizard" as const },
		};
		const ctx = {
			editor: { addToHistory: vi.fn(), setText: vi.fn() },
			editorContainer: { clear: vi.fn(), addChild: vi.fn((child: unknown) => children.push(child)) },
			ui: { setFocus, requestRender: vi.fn(), terminal: { rows: 24 } },
			settings: { get: vi.fn(() => undefined) },
			sessionManager: { getCwd: () => "/tmp" },
			session: {
				extensionRunner: {
					getAllRegisteredIntegrations: () => [
						{
							id: "platform",
							name: "F5 Distributed Cloud Platform",
							plugin: "platform",
							setupPlan: plan,
							get: async () => ({ state: "setup_required" as const, reason: "not_authenticated" as const }),
							invalidate() {},
							verifyAfterSetup: vi.fn(),
						},
					],
				},
			},
			showHookCustom,
			showStatus: vi.fn(),
			showError,
		} as unknown as InteractiveModeContext;

		expect(await executeBuiltinSlashCommand("/plugin setup platform", { ctx, handleBackgroundCommand() {} })).toBe(
			true,
		);
		expect(showHookCustom).not.toHaveBeenCalled();
		expect(showError.mock.calls).toEqual([]);
		expect(children.at(-1)?.constructor.name).toBe("ContextAddWizard");
		expect(setFocus).toHaveBeenCalledWith(children.at(-1));
	});
});
