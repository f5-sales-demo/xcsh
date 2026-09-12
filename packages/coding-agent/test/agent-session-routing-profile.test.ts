import { expect, test, vi } from "bun:test";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import type { Component } from "@f5-sales-demo/pi-tui";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { executeBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";

test("profile command persists and reopens real settings while retrying a failed save without a second model switch", async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
	const temp = TempDir.createSync("xcsh-profile-disk-");
	const agentDir = join(temp.path(), "agent");
	await mkdir(agentDir);
	const config = join(agentDir, "config.yml");
	await Bun.write(config, "routing:\n  profile: none\nmodelRoles:\n  custom: fixture/custom\n");
	_resetSettingsForTest();
	const settings = await Settings.init({ agentDir, cwd: temp.path() });
	const auth = await AuthStorage.create(join(agentDir, "auth.db"));
	auth.setRuntimeApiKey("anthropic", "synthetic-not-a-secret");
	const registry = new ModelRegistry(auth, join(agentDir, "models.yml"));
	const base = getBundledModel("anthropic", "claude-sonnet-4-5")!;
	const models = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"].map(id => ({ ...base, id }));
	const refresh = vi.spyOn(registry, "refresh").mockResolvedValue(undefined);
	const available = vi.spyOn(registry, "getAvailable").mockReturnValue(models);
	const discovery = vi
		.spyOn(registry, "getProviderDiscoveryState")
		.mockReturnValue({ status: "ok", stale: false, models: models.map(m => m.id) } as ReturnType<
			ModelRegistry["getProviderDiscoveryState"]
		>);
	const inference = vi.fn(() => {
		throw new Error("No inference allowed");
	});
	const manager = SessionManager.create(temp.path(), join(temp.path(), "sessions"));
	const session = new AgentSession({
		agent: new Agent({ initialState: { model: base, tools: [], messages: [] }, streamFn: inference }),
		sessionManager: manager,
		settings,
		modelRegistry: registry,
	});
	const switchModel = vi.spyOn(session, "setModelTemporary");
	let component: Component | undefined;
	const ctx = {
		session,
		sessionManager: manager,
		settings,
		editor: { addToHistory() {}, setText() {} },
		ui: {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 40 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	const waitFor = async (predicate: () => boolean) => {
		for (let i = 0; i < 200 && !predicate(); i++) await Bun.sleep(5);
		expect(predicate()).toBe(true);
	};
	try {
		const original = await Bun.file(config).text();
		let pending = executeBuiltinSlashCommand("/route profile anthropic", { ctx, handleBackgroundCommand() {} });
		await waitFor(() => component !== undefined);
		expect(await Bun.file(config).text()).toBe(original);
		component!.handleInput?.("\r");
		await pending;
		expect(await Bun.file(config).text()).toBe(original);
		expect(switchModel).not.toHaveBeenCalled();
		await rename(config, join(agentDir, "original.yml"));
		await mkdir(config);
		component = undefined;
		pending = executeBuiltinSlashCommand("/route profile anthropic", { ctx, handleBackgroundCommand() {} });
		await waitFor(() => component !== undefined);
		component!.handleInput?.("\x1b[B");
		component!.handleInput?.("\r");
		await waitFor(() => Bun.stripANSI(component!.render(100).join("\n")).includes("Unresolved routing profile"));
		expect(session.model?.id).toBe("claude-sonnet-5");
		component!.handleInput?.("\r");
		await pending;
		await rm(config, { recursive: true });
		await rename(join(agentDir, "original.yml"), config);
		refresh.mockRejectedValue(new Error("Offline during save-only retry"));
		component = undefined;
		pending = executeBuiltinSlashCommand("/route profile anthropic", { ctx, handleBackgroundCommand() {} });
		await waitFor(() => component !== undefined);
		expect(Bun.stripANSI(component!.render(100).join("\n"))).toContain("Retry saving only");
		component!.handleInput?.("\x1b[B");
		component!.handleInput?.("\r");
		await pending;
		expect(switchModel).toHaveBeenCalledTimes(1);
		expect(inference).not.toHaveBeenCalled();
		expect(Bun.YAML.parse(await Bun.file(config).text())).toMatchObject({
			routing: { profile: "anthropic" },
			modelRoles: { default: "anthropic/claude-sonnet-5:medium", custom: "fixture/custom" },
		});
		_resetSettingsForTest();
		const reopened = await Settings.init({ agentDir, cwd: temp.path() });
		expect(reopened.get("routing.profile")).toBe("anthropic");
		expect(reopened.getModelRoles().default).toBe("anthropic/claude-sonnet-5:medium");
	} finally {
		await settings.flush();
		await session.dispose();
		switchModel.mockRestore();
		refresh.mockRestore();
		available.mockRestore();
		discovery.mockRestore();
		auth.close();
		_resetSettingsForTest();
		temp.removeSync();
	}
});

test("routing profile preparation is read-only and changed reviewed roles cannot be applied", async () => {
	const temp = TempDir.createSync("xcsh-profile-review-");
	const auth = await AuthStorage.create(join(temp.path(), "auth.db"));
	const settings = Settings.isolated();
	settings.set("modelRoles", { default: "fixture/original", custom: "fixture/custom" });
	settings.override("modelRoles", { custom: "runtime/only" });
	const registry = new ModelRegistry(auth, join(temp.path(), "models.yml"));
	const refresh = vi.spyOn(registry, "refresh").mockResolvedValue(undefined);
	let models = ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"];
	const discovery = vi.spyOn(registry, "getProviderDiscoveryState").mockImplementation(
		() =>
			({
				status: "ok",
				stale: false,
				models,
			}) as ReturnType<ModelRegistry["getProviderDiscoveryState"]>,
	);
	const session = new AgentSession({
		agent: new Agent({
			initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5")!, tools: [], messages: [] },
		}),
		sessionManager: SessionManager.create(temp.path(), join(temp.path(), "sessions")),
		settings,
		modelRegistry: registry,
	});
	try {
		const before = settings.inspectScopes("modelRoles");
		const modelBefore = session.model;
		const prepared = await session.prepareRoutingProfile("anthropic");
		expect(prepared.applied).toBe(true);
		expect(prepared.roles.smol).toBe("anthropic/claude-haiku-4-5-20251001:low");
		expect(prepared.roles.custom).toBe("fixture/custom");
		expect(settings.inspectScopes("modelRoles")).toEqual(before);
		expect(session.model).toBe(modelBefore);
		models = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"];
		await expect(session.applyRoutingProfile("anthropic", prepared.roles)).rejects.toThrow("changed");
		expect(settings.inspectScopes("modelRoles")).toEqual(before);
		expect(session.model).toBe(modelBefore);
		let sameTarget = true;
		const guarded = await session.prepareRoutingProfile("anthropic");
		refresh.mockImplementationOnce(async () => {
			sameTarget = false;
		});
		const guard = vi.fn(() => sameTarget);
		await expect(session.applyRoutingProfile("anthropic", guarded.roles, guard)).rejects.toThrow(
			"reviewed target changed",
		);
		expect(guard).toHaveBeenCalledTimes(1);
		expect(settings.inspectScopes("modelRoles")).toEqual(before);
		settings.set("routing.profile", "none");
		settings.override("routing.profile", "openai-codex");
		const profileBefore = settings.inspectScopes("routing.profile");
		const resolveModel = vi
			.spyOn(session, "resolveRoleModelWithThinking")
			.mockReturnValue({ model: undefined } as ReturnType<AgentSession["resolveRoleModelWithThinking"]>);
		try {
			await expect(session.applyRoutingProfile("anthropic", guarded.roles)).rejects.toThrow("Default model");
			expect(settings.inspectScopes("routing.profile")).toEqual(profileBefore);
			expect(settings.inspectScopes("modelRoles")).toEqual(before);
			resolveModel.mockImplementation(() => {
				throw new Error("Synthetic resolution failure");
			});
			await expect(session.applyRoutingProfile("anthropic", guarded.roles)).rejects.toThrow(
				"Synthetic resolution failure",
			);
			expect(settings.inspectScopes("routing.profile")).toEqual(profileBefore);
			expect(settings.inspectScopes("modelRoles")).toEqual(before);
		} finally {
			resolveModel.mockRestore();
		}
		models = [];
		const unavailable = await session.prepareRoutingProfile("anthropic");
		expect(unavailable.applied).toBe(false);
		expect(unavailable.missingModels.length).toBeGreaterThan(0);
		expect(settings.inspectScopes("modelRoles")).toEqual(before);
	} finally {
		refresh.mockRestore();
		discovery.mockRestore();
		await session.dispose();
		auth.close();
		temp.removeSync();
	}
});
