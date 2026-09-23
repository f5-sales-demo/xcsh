import { beforeAll, describe, expect, it, vi } from "bun:test";
import {
	runInstallAuthorizedPluginSetup,
	runInstallAuthorizedPluginSetupInForeground,
} from "../../../src/modes/controllers/selector-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(async () => {
	const selected = await getThemeByName("xcsh-dark");
	if (!selected) throw new Error("Missing test theme");
	setThemeInstance(selected);
});

describe("SelectorController plugin setup handoff", () => {
	it("executes install-authorized setup without opening a second review", async () => {
		const plan = {
			pluginDependencies: [],
			requiredEnvironment: ["XCSH_API_URL"],
			profileFields: [],
			steps: [
				{
					kind: "install" as const,
					argv: ["controller", "setup", "apply"],
					timeoutMs: 1_000,
					environment: ["XCSH_API_URL"],
				},
			],
			verification: [],
		};
		const run = vi.fn(async () => 0);
		const result = await runInstallAuthorizedPluginSetup(
			{
				settings: { get: vi.fn(() => "https://tenant.example.test") },
				session: {
					extensionRunner: {
						getAllRegisteredIntegrations: () => [
							{
								id: "kvm",
								name: "KVM",
								plugin: "kvm@catalog",
								setupPlan: plan,
								get: async () => ({ state: "setup_required" as const }),
								invalidate() {},
								verifyAfterSetup: async () => ({ state: "ready" as const }),
							},
						],
					},
				},
			} as unknown as Pick<InteractiveModeContext, "settings" | "session">,
			"kvm",
			{ setupRequired: true, setupAuthorization: "install" },
			run,
		);

		expect(run).toHaveBeenCalledTimes(1);
		expect(result?.state).toBe("ready");
	});
});

it("keeps install-authorized setup in a foreground loader and restores the editor", async () => {
	let finish!: () => void;
	const run = vi.fn(
		() =>
			new Promise<number>(resolve => {
				finish = () => resolve(0);
			}),
	);
	const added: unknown[] = [];
	const focused: unknown[] = [];
	const ctx = {
		settings: { get: vi.fn(() => undefined) },
		session: {
			extensionRunner: {
				getAllRegisteredIntegrations: () => [
					{
						id: "kvm",
						name: "KVM",
						plugin: "kvm@catalog",
						setupPlan: {
							pluginDependencies: [],
							requiredEnvironment: [],
							profileFields: [],
							steps: [{ kind: "install" as const, argv: ["controller", "setup"], timeoutMs: 1_000 }],
							verification: [],
						},
						get: async () => ({ state: "setup_required" as const }),
						invalidate() {},
						verifyAfterSetup: async () => ({ state: "ready" as const }),
					},
				],
			},
		},
		ui: {
			setFocus: vi.fn((target: unknown) => focused.push(target)),
			requestRender: vi.fn(),
		},
		editorContainer: {
			clear: vi.fn(),
			addChild: vi.fn((child: unknown) => added.push(child)),
		},
		editor: { handleInput: vi.fn() },
		showStatus: vi.fn(),
		showError: vi.fn(),
	};

	const pending = runInstallAuthorizedPluginSetupInForeground(
		ctx as unknown as InteractiveModeContext,
		"kvm",
		{ setupRequired: true, setupAuthorization: "install" },
		run,
	);
	await Bun.sleep(0);
	expect(focused.at(-1)).not.toBe(ctx.editor);
	expect(ctx.editor.handleInput).not.toHaveBeenCalled();

	finish();
	await pending;
	expect(added.at(-1)).toBe(ctx.editor);
	expect(focused.at(-1)).toBe(ctx.editor);
	expect(ctx.showStatus).toHaveBeenCalledWith("Plugin setup completed: kvm.");
	expect(ctx.showError).not.toHaveBeenCalled();
});
