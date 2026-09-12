import { beforeAll, expect, test, vi } from "bun:test";
import type { UsageReport } from "@f5-sales-demo/pi-ai";
import type { Component } from "@f5-sales-demo/pi-tui";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { locales } from "../../../src/locales";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(async () => {
	registerLocales(locales);
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
});

const reports: UsageReport[] = [
	{
		provider: "openai-codex",
		fetchedAt: Date.now() - 1_000,
		limits: [
			{
				id: "synthetic-five-hour",
				label: "Five hour",
				scope: {
					provider: "openai-codex",
					accountId: "synthetic-account",
					windowId: "5h",
				},
				window: { id: "5h", label: "5 Hour", resetsAt: Date.now() + 60_000 },
				amount: { unit: "percent", usedFraction: 0.25 },
				status: "ok",
			},
		],
		metadata: { email: "synthetic@example.test" },
	},
];

function harness(overrides: Record<string, unknown> = {}) {
	const screens: string[] = [];
	const mounted: Component[] = [];
	const ui = {
		terminal: { rows: 20, columns: 60 },
		requestRender: vi.fn(),
		setFocus: vi.fn(),
	};
	const editor = {} as Component;
	const editorContainer = {
		clear: vi.fn(),
		addChild: vi.fn((component: Component) => mounted.push(component)),
	};
	const ctx = {
		ui,
		editor,
		editorContainer,
		keybindings: { getDisplayString: () => "Ctrl+K" },
		session: {
			fetchUsageReports: vi.fn(async () => reports),
			getAsyncJobSnapshot: () => ({ running: [], recent: [] }),
			agent: { state: { tools: [] } },
		},
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (factory: (ui: unknown, theme: unknown, keys: unknown, done: () => void) => Component) =>
			new Promise<void>(resolve => {
				const component = factory(ui, {}, {}, resolve);
				screens.push(Bun.stripANSI(component.render(60).join("\n")));
				component.handleInput?.("\x1b");
			}),
		...overrides,
	} as unknown as InteractiveModeContext;
	return { ctx, screens, mounted, controller: new CommandController(ctx) };
}

test("jobs uses a bounded empty state and a scoped populated report", async () => {
	const empty = harness();
	await empty.controller.handleJobsCommand();
	expect(empty.screens[0]).toContain("Background Jobs");
	expect(empty.screens[0]).toContain("Current session · empty");
	expect(empty.screens[0]).toContain("No async jobs");

	const populated = harness({
		session: {
			getAsyncJobSnapshot: () => ({
				running: [
					{
						id: "job-running",
						type: "tool",
						status: "running",
						startTime: Date.now() - 2_000,
						label: "Synthetic running job",
					},
				],
				recent: [
					{
						id: "job-done",
						type: "tool",
						status: "completed",
						startTime: Date.now() - 3_000,
						label: "Synthetic completed job",
					},
				],
			}),
		},
	});
	await populated.controller.handleJobsCommand();
	expect(populated.screens[0]).toContain("1 running · 1 recent");
	expect(populated.screens[0]).toContain("job-running");
	expect(populated.screens[0]).toContain("Synthetic running job");
});

test("usage mounts a non-cancellable loader, renders a bounded report, and retains successful cache", async () => {
	const fetchUsageReports = vi.fn(async () => reports);
	const h = harness({
		session: {
			fetchUsageReports,
			getAsyncJobSnapshot: () => null,
			agent: { state: { tools: [] } },
		},
	});
	await h.controller.handleUsageCommand();
	expect(fetchUsageReports).toHaveBeenCalledTimes(1);
	expect(
		h.mounted.some(component => Bun.stripANSI(component.render(60).join("\n")).includes("Refreshing provider usage")),
	).toBe(true);
	expect(h.screens[0]).toContain("Usage");
	expect(h.screens[0]).toContain("Provider limits");
	expect(h.screens[0]).toContain("Openai Codex");

	fetchUsageReports.mockRejectedValueOnce(new Error("synthetic offline"));
	await h.controller.handleUsageCommand();
	expect(h.screens[1]).toContain("Cached data · refresh failed");
	expect(h.screens[1]).toContain("synthetic offline");
	expect(h.screens[1]).toContain("Openai Codex");
});

test("usage rejects a duplicate refresh and distinguishes empty and unavailable data", async () => {
	const deferred = Promise.withResolvers<UsageReport[] | null>();
	const fetchUsageReports = vi.fn(() => deferred.promise);
	const h = harness({
		session: {
			fetchUsageReports,
			getAsyncJobSnapshot: () => null,
			agent: { state: { tools: [] } },
		},
	});
	const first = h.controller.handleUsageCommand();
	await Bun.sleep(0);
	await h.controller.handleUsageCommand();
	expect(h.ctx.showStatus).toHaveBeenCalledWith("Usage refresh is already running; duplicate request ignored.");
	expect(fetchUsageReports).toHaveBeenCalledTimes(1);
	deferred.resolve([]);
	await first;
	expect(h.ctx.showWarning).toHaveBeenCalledWith(expect.stringContaining("No usage data"));

	const unavailable = harness({
		session: {
			getAsyncJobSnapshot: () => null,
			agent: { state: { tools: [] } },
		},
	});
	await unavailable.controller.handleUsageCommand();
	expect(unavailable.ctx.showWarning).toHaveBeenCalledWith(expect.stringContaining("not configured"));
});

test("hotkeys and tools use the shared paged Markdown report", async () => {
	const h = harness();
	await h.controller.handleHotkeysCommand();
	expect(h.screens[0]).toContain("Keyboard Shortcuts");
	expect(h.screens[0]).toContain("Effective terminal keybindings");
	expect(h.screens[0]).toContain("Navigation");
	expect(h.screens[0]).toContain("details");
	await h.controller.handleToolsCommand();
	expect(h.screens[1]).toContain("Available Tools");
	expect(h.screens[1]).toContain("Tools available to the active model");
});
