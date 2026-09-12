import { beforeAll, describe, expect, it, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { createDashboardController } from "../src/autoresearch/dashboard";
import { createSessionRuntime } from "../src/autoresearch/state";
import { KeybindingsManager } from "../src/config/keybindings";
import type { ExtensionContext } from "../src/extensibility/extensions";
import { getThemeByName, setThemeInstance, theme } from "../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

describe("autoresearch dashboard extension dialog", () => {
	it("keeps custom rendering bounded and closes through Escape without changing extension callbacks", async () => {
		const runtime = createSessionRuntime();
		runtime.autoresearchMode = true;
		runtime.state.name = "synthetic experiment";
		runtime.state.results.push({
			runNumber: 1,
			commit: "abc1234",
			metric: 10,
			metrics: {},
			status: "keep",
			description: "baseline",
			timestamp: 1,
			segment: 0,
			confidence: null,
		});
		const tui = { requestRender: vi.fn(), terminal: { columns: 60, rows: 20 } };
		let rendered: string[] = [];
		const custom = vi.fn(
			async <T>(
				factory: (
					tuiArg: typeof tui,
					themeArg: typeof theme,
					keys: KeybindingsManager,
					done: (result: T) => void,
				) => { render(width: number): string[]; handleInput(data: string): void },
			): Promise<T> =>
				await new Promise<T>(resolve => {
					const component = factory(tui, theme, KeybindingsManager.inMemory(), resolve);
					rendered = component.render(60);
					component.handleInput("\x1b");
				}),
		);
		const ctx = { hasUI: true, ui: { custom } } as unknown as ExtensionContext;
		await createDashboardController().showOverlay(ctx, runtime);
		expect(custom).toHaveBeenCalledTimes(1);
		expect(rendered.length).toBeLessThanOrEqual(20);
		expect(rendered.every(line => visibleWidth(line) <= 60)).toBe(true);
		expect(Bun.stripANSI(rendered.join("\n"))).toContain("autoresearch: synthetic experiment");
	});
});
