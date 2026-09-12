import { beforeAll, expect, test, vi } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import type { Component } from "@f5-sales-demo/pi-tui";
import { Settings } from "../../../src/config/settings";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { initTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { RoutingCoordinator } from "../../../src/routing/coordinator";

beforeAll(() => initTheme());

test("model selection is cancel-first, preserves browse context, persists only after review, and skips exact no-ops", async () => {
	const current = getBundledModel("anthropic", "claude-sonnet-4-5")!;
	const target = getBundledModel("google-vertex", "gemini-2.5-pro")!;
	const settings = Settings.isolated();
	settings.set("modelRoles", { default: "anthropic/claude-sonnet-4-5:inherit" });
	const settingsFlush = vi.spyOn(settings, "flush");
	const routingCoordinator = new RoutingCoordinator();
	const appendCustomEntry = vi.fn();
	const sessionFlush = vi.fn(async () => {});
	const ensureOnDisk = vi.fn(async () => {});
	const setModelTemporary = vi.fn(async (model, thinkingLevel) => {
		session.model = model;
		session.thinkingLevel = thinkingLevel;
	});
	const session = {
		model: current,
		thinkingLevel: ThinkingLevel.Inherit,
		sessionId: "model-review-session",
		settings,
		routingCoordinator,
		modelRegistry: {
			getAll: () => [current, target],
			getApiKey: vi.fn(async () => "synthetic-runtime-key"),
		},
		scopedModels: [
			{ model: current, thinkingLevel: ThinkingLevel.Inherit },
			{ model: target, thinkingLevel: ThinkingLevel.Inherit },
		],
		sessionManager: { appendCustomEntry, ensureOnDisk, flush: sessionFlush },
		setModelTemporary,
		getRoutingState: () => routingCoordinator.getStateMachine().getState(),
		restoreRoutingState: vi.fn(),
	};
	let active: Component | undefined;
	let confirm = false;
	const reviews: string[] = [];
	const showStatus = vi.fn();
	const ctx = {
		editor: { render: () => [] },
		editorContainer: {
			clear: () => {
				active = undefined;
			},
			addChild: (component: Component) => {
				active = component;
			},
		},
		ui: { terminal: { rows: 24, columns: 80 }, requestRender: vi.fn(), setFocus: vi.fn() },
		settings,
		session,
		sessionManager: { getSessionId: () => "model-review-session" },
		statusLine: { invalidate: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		showStatus,
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				const component = factory(ctx.ui, {}, {}, resolve);
				reviews.push(Bun.stripANSI(component.render(80).join("\n")));
				if (confirm) component.handleInput?.("\x1b[B");
				component.handleInput?.("\r");
			}),
	} as unknown as InteractiveModeContext;
	const controller = new SelectorController(ctx);
	controller.showModelSelector();
	await Bun.sleep(0);
	const selector = active!;
	for (const character of "gemini") selector.handleInput?.(character);

	const chooseConversation = () => {
		selector.handleInput?.("\r");
		selector.handleInput?.("\r");
		selector.handleInput?.("\r");
	};
	chooseConversation();
	await Bun.sleep(0);

	expect(reviews[0]).toContain("Review model selection");
	expect(reviews[0]).toContain("Session model-review-session · active model and routing pin");
	expect(reviews[0]).toContain("Active model / reasoning:");
	expect(reviews[0]).toContain("google-vertex/gemini-2.5-pro");
	expect(setModelTemporary).not.toHaveBeenCalled();
	expect(sessionFlush).not.toHaveBeenCalled();
	expect(active).toBe(selector);
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("gemini");

	confirm = true;
	chooseConversation();
	for (let index = 0; index < 100 && setModelTemporary.mock.calls.length === 0; index++) await Bun.sleep(1);
	expect(setModelTemporary).toHaveBeenCalledTimes(1);
	expect(sessionFlush).toHaveBeenCalledTimes(1);
	expect(ensureOnDisk).toHaveBeenCalledTimes(1);
	expect(appendCustomEntry).toHaveBeenCalledWith("routing_event", expect.any(Object));
	expect(routingCoordinator.getStateMachine().getState().manualPin).toBe("google-vertex/gemini-2.5-pro");
	expect(settingsFlush).not.toHaveBeenCalled();
	expect(showStatus).toHaveBeenCalledWith("This conversation: google-vertex/gemini-2.5-pro · reasoning inherit");

	controller.showModelSelector({ initialSearchInput: "gemini", initialSelector: "google-vertex/gemini-2.5-pro" });
	await Bun.sleep(0);
	const noOpSelector = active!;
	noOpSelector.handleInput?.("\r");
	noOpSelector.handleInput?.("\r");
	noOpSelector.handleInput?.("\r");
	await Bun.sleep(0);
	expect(reviews).toHaveLength(2);
	expect(setModelTemporary).toHaveBeenCalledTimes(1);
	expect(sessionFlush).toHaveBeenCalledTimes(1);
	expect(ensureOnDisk).toHaveBeenCalledTimes(1);
	expect(showStatus).toHaveBeenLastCalledWith(
		"google-vertex/gemini-2.5-pro is already applied at this scope. Nothing changed.",
	);
});
