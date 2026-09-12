import { beforeAll, expect, test, vi } from "bun:test";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { RoutingCoordinator } from "../../src/routing/coordinator";
import { SUBSCRIPTION_ROUTING_PROFILES } from "../../src/routing/subscription-profiles";
import type { RoutingMode } from "../../src/routing/types";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
test("profile save retry does not repeat an already completed profile/model application", async () => {
	const settings = Settings.isolated();
	const roles = { default: "anthropic/claude-sonnet-5:medium" };
	const prepare = vi.fn(async () => ({ applied: true, roles, missingModels: [] }));
	const flush = vi.fn(async () => {}).mockRejectedValueOnce(new Error("Synthetic disk failure"));
	settings.flush = flush;
	const apply = vi.fn(async () => {
		settings.set("modelRoles", roles);
		settings.set("routing.profile", "anthropic");
		return { applied: true, missingModels: [] };
	});
	let attempt = 0;
	const screens: string[] = [];
	const ctx = {
		editor: { addToHistory() {}, setText() {} },
		settings,
		sessionManager: { getSessionId: () => "retry-profile" },
		session: {
			routingCoordinator: new RoutingCoordinator(),
			getRoutingStatus: () => ({ mode: "off", profile: settings.get("routing.profile") }),
			prepareRoutingProfile: prepare,
			applyRoutingProfile: apply,
		},
		ui: {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise((resolve, reject) => {
				const component = factory({ terminal: { rows: 40 }, requestRender() {} }, {}, {}, resolve);
				screens.push(Bun.stripANSI(component.render(100).join("\n")));
				component.handleInput?.("\x1b[B");
				component.handleInput?.("\r");
				if (attempt++ === 0)
					void (async () => {
						for (
							let i = 0;
							i < 200 && !Bun.stripANSI(component.render(100).join("\n")).includes("Unresolved routing profile");
							i++
						)
							await Bun.sleep(5);
						expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("Unresolved routing profile");
						component.handleInput?.("\r");
					})().catch(reject);
			}),
	} as unknown as InteractiveModeContext;
	const runtime = { ctx, handleBackgroundCommand() {} };
	await executeBuiltinSlashCommand("/route profile anthropic", runtime);
	expect(ctx.showError).toHaveBeenCalledWith(expect.stringContaining("unresolved"));
	prepare.mockRejectedValue(new Error("Offline catalog must not block save-only retry"));
	await executeBuiltinSlashCommand("/route profile anthropic", runtime);
	expect(apply).toHaveBeenCalledTimes(1);
	expect(flush).toHaveBeenCalledTimes(2);
	expect(prepare).toHaveBeenCalledTimes(2);
	expect(screens[1]).toContain("Retry saving");
});
test("route profile resolves exact assignments before a cancel-first review without applying them", async () => {
	const settings = Settings.isolated();
	settings.set("modelRoles", { default: "fixture/original" });
	const roles = { default: "anthropic/claude-sonnet-5:medium", smol: "anthropic/claude-haiku-4-5-20251001:low" };
	const applyRoutingProfile = vi.fn(async () => ({ applied: true, missingModels: [] }));
	let screen = "";
	const ctx = {
		editor: { addToHistory() {}, setText() {} },
		settings,
		sessionManager: { getSessionId: () => "profile-fixture" },
		session: {
			routingCoordinator: new RoutingCoordinator(),
			getRoutingStatus: () => ({ mode: "off", profile: "none" }),
			prepareRoutingProfile: vi.fn(async () => ({ applied: true, roles, missingModels: [] })),
			applyRoutingProfile,
		},
		ui: {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				const component = factory({ terminal: { rows: 40 }, requestRender() {} }, {}, {}, resolve);
				screen = Bun.stripANSI(component.render(100).join("\n"));
				component.handleInput?.("\r");
			}),
	} as unknown as InteractiveModeContext;
	await executeBuiltinSlashCommand("/route profile anthropic", { ctx, handleBackgroundCommand() {} });
	expect(applyRoutingProfile).not.toHaveBeenCalled();
	expect(screen).toContain("Review routing profile");
	expect(screen).toContain("claude-haiku-4-5-20251001:low");
	expect(settings.getModelRoles().default).toBe("fixture/original");
});
test("an already effective routing profile performs no review, model switch, or settings write", async () => {
	const settings = Settings.isolated();
	const roles = { ...SUBSCRIPTION_ROUTING_PROFILES.anthropic.roles };
	settings.set("modelRoles", roles);
	settings.set("routing.profile", "anthropic");
	const flush = vi.fn(async () => {});
	settings.flush = flush;
	const applyRoutingProfile = vi.fn(async () => ({ applied: true, missingModels: [] }));
	const ctx = {
		editor: { addToHistory() {}, setText() {} },
		settings,
		sessionManager: { getSessionId: () => "profile-noop" },
		session: {
			model: { provider: "anthropic", id: "claude-sonnet-5" },
			thinkingLevel: "medium",
			routingCoordinator: new RoutingCoordinator(),
			getRoutingStatus: () => ({ mode: "off", profile: "anthropic" }),
			prepareRoutingProfile: vi.fn(async () => ({ applied: true, roles, missingModels: [] })),
			applyRoutingProfile,
		},
		ui: {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: vi.fn(),
	} as unknown as InteractiveModeContext;
	await executeBuiltinSlashCommand("/route profile anthropic", { ctx, handleBackgroundCommand() {} });
	expect(applyRoutingProfile).not.toHaveBeenCalled();
	expect(flush).not.toHaveBeenCalled();
	expect(ctx.showHookCustom).not.toHaveBeenCalled();
	expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Nothing changed"));
});
test("route status and invalid commands use supported feedback without opening reviews", async () => {
	const settings = Settings.isolated();
	settings.set("routing.mode", "shadow");
	settings.override("routing.mode", "off");
	settings.set("routing.profile", "anthropic");
	settings.override("routing.profile", "openai-codex");
	const coordinator = new RoutingCoordinator();
	const ctx = {
		editor: { addToHistory() {}, setText() {} },
		settings,
		session: { routingCoordinator: coordinator, getRoutingStatus: () => ({ mode: "off", profile: "none" }) },
		ui: {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: vi.fn(),
	} as unknown as InteractiveModeContext;
	const runtime = { ctx, handleBackgroundCommand() {} };
	await executeBuiltinSlashCommand("/route", runtime);
	expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("User routing mode: shadow"));
	expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Effective Routing Mode: off"));
	expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("User routing profile: anthropic"));
	expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("runtime: openai-codex"));
	await executeBuiltinSlashCommand("/route invalid", runtime);
	expect(ctx.showError).toHaveBeenCalledWith(expect.stringContaining("Unknown /route subcommand"));
	await executeBuiltinSlashCommand("/route profile constructor", runtime);
	expect(ctx.showError).toHaveBeenCalledWith(expect.stringContaining("Usage"));
	await executeBuiltinSlashCommand("/route auto unexpected", runtime);
	expect(ctx.showError).toHaveBeenCalledWith(expect.stringContaining("Usage"));
	expect(ctx.showHookCustom).not.toHaveBeenCalled();
});
test("route persistence: Cancel preserves bytes, failed write preserves pin, retry saves without repeating mutation", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-route-save-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	const config = join(agentDir, "config.yml");
	await mkdir(agentDir);
	await mkdir(cwd);
	await Bun.write(config, "routing:\n  mode: off\n  profile: none\n");
	_resetSettingsForTest();
	let settings: Settings | undefined;
	try {
		settings = await Settings.init({ agentDir, cwd });
		const original = await Bun.file(config).text();
		const coordinator = new RoutingCoordinator();
		coordinator.getStateMachine().setManualPin("fixture/pinned");
		let component: Component | undefined;
		let sessionId = "disk-fixture";
		const showStatus = vi.fn();
		const setRoutingMode = vi.fn((value: RoutingMode) => settings!.set("routing.mode", value));
		const ctx = {
			editor: { addToHistory() {}, setText() {} },
			sessionManager: { getSessionId: () => sessionId },
			settings,
			session: {
				routingCoordinator: coordinator,
				getRoutingStatus: () => ({
					mode: settings!.get("routing.mode"),
					profile: "none",
					manualPin: coordinator.getStateMachine().getState().manualPin,
				}),
				setRoutingMode,
				clearRoutingPin: () => coordinator.getStateMachine().clearManualPin(),
			},
			ui: { requestRender() {} },
			showStatus,
			showError: vi.fn(),
			showHookCustom: (
				factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
			) =>
				new Promise(resolve => {
					component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				}),
		} as unknown as InteractiveModeContext;
		const waitFor = async (predicate: () => boolean) => {
			for (let i = 0; i < 200 && !predicate(); i++) await Bun.sleep(5);
			expect(predicate()).toBe(true);
		};
		const run = () => {
			component = undefined;
			return executeBuiltinSlashCommand("/route auto", { ctx, handleBackgroundCommand() {} });
		};
		let pending = run();
		await waitFor(() => component !== undefined);
		expect(await Bun.file(config).text()).toBe(original);
		component!.handleInput?.("\r");
		await pending;
		expect(await Bun.file(config).text()).toBe(original);
		expect(setRoutingMode).not.toHaveBeenCalled();
		pending = run();
		await waitFor(() => component !== undefined);
		const firstReview = component;
		await executeBuiltinSlashCommand("/route shadow", { ctx, handleBackgroundCommand() {} });
		expect(component).toBe(firstReview);
		expect(ctx.showStatus).toHaveBeenCalledWith("A routing review is already open.");
		expect(setRoutingMode).not.toHaveBeenCalled();
		sessionId = "different-session";
		component!.handleInput?.("\x1b[B");
		component!.handleInput?.("\r");
		await waitFor(() => Bun.stripANSI(component!.render(80).join("\n")).includes("target changed"));
		expect(setRoutingMode).not.toHaveBeenCalled();
		expect(await Bun.file(config).text()).toBe(original);
		component!.handleInput?.("\r");
		await pending;
		sessionId = "disk-fixture";
		showStatus.mockClear();
		// The disposable destination is deliberately unwritable as a file, independently of user privileges.
		await rename(config, join(agentDir, "original.yml"));
		await mkdir(config);
		pending = run();
		await waitFor(() => component !== undefined);
		component!.handleInput?.("\x1b[B");
		component!.handleInput?.("\r");
		await waitFor(() => Bun.stripANSI(component!.render(80).join("\n")).includes("Unresolved routing mode"));
		expect(coordinator.getStateMachine().getState().manualPin).toBe("fixture/pinned");
		expect(ctx.showStatus).not.toHaveBeenCalled();
		component!.handleInput?.("\r");
		await pending;
		expect(ctx.showError).toHaveBeenCalledWith(expect.stringContaining("unresolved"));
		await rm(config, { recursive: true });
		await rename(join(agentDir, "original.yml"), config);
		pending = run();
		await waitFor(() => component !== undefined);
		component!.handleInput?.("\x1b[B");
		component!.handleInput?.("\r");
		await pending;
		expect(setRoutingMode).toHaveBeenCalledTimes(1);
		expect(Bun.YAML.parse(await Bun.file(config).text())).toMatchObject({
			routing: { mode: "auto", profile: "none" },
		});
		expect(coordinator.getStateMachine().getState().manualPin).toBeUndefined();
		const savedBytes = await Bun.file(config).text();
		const flushSpy = vi.spyOn(settings, "flush");
		pending = run();
		let finished = false;
		void pending.then(() => {
			finished = true;
		});
		await waitFor(() => finished || component !== undefined);
		const unwantedReview = component;
		component?.handleInput?.("\r");
		await pending;
		expect(unwantedReview).toBeUndefined();
		expect(flushSpy).not.toHaveBeenCalled();
		expect(await Bun.file(config).text()).toBe(savedBytes);
		flushSpy.mockRestore();
		_resetSettingsForTest();
		const reopened = await Settings.init({ agentDir, cwd });
		expect(reopened.get("routing.mode")).toBe("auto");
	} finally {
		await settings?.flush();
		_resetSettingsForTest();
		await rm(root, { recursive: true, force: true });
	}
});
for (const override of [undefined, "auto", "off"] as const)
	for (const confirm of [false, true])
		test(`route auto override=${override} ${confirm ? "confirmation saves before clearing the pin" : "cancellation preserves state"}`, async () => {
			const coordinator = new RoutingCoordinator();
			coordinator.getStateMachine().setManualPin("fixture/pinned");
			const settings = Settings.isolated();
			settings.set("routing.mode", "off");
			if (override) settings.override("routing.mode", override);
			const setRoutingMode = vi.fn((value: RoutingMode) => {
				settings.set("routing.mode", value);
			});
			const flush = vi.fn(async () => {
				expect(coordinator.getStateMachine().getState().manualPin).toBe("fixture/pinned");
			});
			const notify = vi.fn();
			settings.flush = flush;
			const screens: string[] = [];
			const ctx = {
				editor: { addToHistory() {}, setText() {} },
				sessionManager: { getSessionId: () => "fixture" },
				settings,
				session: {
					routingCoordinator: coordinator,
					getRoutingStatus: () => ({
						mode: settings.get("routing.mode"),
						profile: "none",
						manualPin: coordinator.getStateMachine().getState().manualPin,
					}),
					setRoutingMode,
					clearRoutingPin: () => coordinator.getStateMachine().clearManualPin(),
				},
				ui: { notify, requestRender() {} },
				showStatus: vi.fn(),
				showError: vi.fn(),
				showHookCustom: (
					factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
				) =>
					new Promise(resolve => {
						const component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
						screens.push(Bun.stripANSI(component.render(80).join("\n")));
						expect(setRoutingMode).not.toHaveBeenCalled();
						if (confirm) component.handleInput?.("\x1b[B");
						component.handleInput?.("\r");
					}),
			} as unknown as InteractiveModeContext;
			await executeBuiltinSlashCommand("/route auto", { ctx, handleBackgroundCommand() {} });
			if (confirm) {
				expect(setRoutingMode).toHaveBeenCalledWith("auto");
				expect(flush).toHaveBeenCalledWith({ throwOnError: true });
				expect(settings.inspectScopes("routing.mode").userValue).toBe("auto");
				expect(coordinator.getStateMachine().getState().manualPin).toBe(
					override === "off" ? "fixture/pinned" : undefined,
				);
				expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Saved routing mode: auto"));
			} else {
				expect(setRoutingMode).not.toHaveBeenCalled();
				expect(flush).not.toHaveBeenCalled();
				expect(coordinator.getStateMachine().getState().manualPin).toBe("fixture/pinned");
			}
			expect(notify).not.toHaveBeenCalled();
			expect(screens[0]).toContain("Review routing mode");
			expect(screens[0]).toContain("User routing mode: off");
		});
