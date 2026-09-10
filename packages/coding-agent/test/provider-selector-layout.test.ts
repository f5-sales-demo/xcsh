import { beforeAll, expect, test, vi } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { ModelSelectorComponent } from "../src/modes/components/model-selector";
import { OAuthSelectorComponent } from "../src/modes/components/oauth-selector";
import { getLoginOptions } from "../src/modes/controllers/login-options";
import { getThemeByName, setSymbolPreset, setThemeInstance } from "../src/modes/theme/theme";
import type { AuthStorage } from "../src/session/auth-storage";
import { providerSelectorFixture } from "./helpers/provider-selector-fixture";

beforeAll(async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
});
for (const themeName of ["xcsh-dark", "xcsh-light"])
	for (const symbols of ["unicode", "ascii"] as const)
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			test(`${themeName} ${symbols} ${columns}x${rows}: selected identities and actions remain visible`, async () => {
				setThemeInstance((await getThemeByName(themeName))!);
				await setSymbolPreset(symbols);
				const fixture = providerSelectorFixture();
				const ui = { terminal: { rows, columns }, requestRender: vi.fn() } as unknown as TUI;
				const selector = new ModelSelectorComponent(
					ui,
					fixture.active,
					fixture.settings,
					fixture.registry,
					[],
					vi.fn(),
					vi.fn(),
				);
				await Bun.sleep(0);
				const check = (component: { render(width: number): string[] }) => {
					const lines = component.render(columns);
					expect(lines.length).toBeLessThanOrEqual(rows);
					expect(lines.every(line => visibleWidth(line) <= Math.min(100, columns))).toBe(true);
					expect(Bun.stripANSI(lines.join("\n"))).toContain("Enter:");
					return Bun.stripANSI(lines.join("\n"));
				};
				expect(check(selector)).toContain("litellm/gpt-5.6-sol");
				selector.handleInput("\r");
				expect(check(selector)).toContain("Save as default");
				selector.handleInput("\r");
				expect(check(selector)).toContain("Reasoning");
				const provider = new OAuthSelectorComponent(
					"login",
					{ hasAuth: () => false } as unknown as AuthStorage,
					vi.fn(),
					vi.fn(),
					{ rows: () => rows, catalogProviders: getLoginOptions() },
				);
				for (let i = 0; i < 25; i++) {
					provider.handleInput("\x1b[B");
					check(provider);
				}
				provider.stopValidation();
				selector.dispose();
			});
		}
test("failed application retains model, scope and reasoning for retry", async () => {
	const fixture = providerSelectorFixture();
	const onSelect = vi
		.fn()
		.mockRejectedValueOnce(new Error("synthetic persistence failure"))
		.mockResolvedValue(undefined);
	const selector = new ModelSelectorComponent(
		{ terminal: { rows: 24 }, requestRender: vi.fn() } as unknown as TUI,
		fixture.active,
		fixture.settings,
		fixture.registry,
		[],
		onSelect,
		vi.fn(),
	);
	await Bun.sleep(0);
	selector.handleInput("\r");
	selector.handleInput("\x1b[B");
	selector.handleInput("\r");
	selector.handleInput("\x1b[B");
	selector.handleInput("\r");
	await Bun.sleep(0);
	const text = Bun.stripANSI(selector.render(100).join("\n"));
	expect(text).toContain("Saved default");
	expect(text).toContain("Reasoning: High");
	expect(text).toContain("Enter to retry");
	selector.handleInput("\r");
	await Bun.sleep(0);
	expect(onSelect).toHaveBeenCalledTimes(2);
	expect(onSelect.mock.calls[0]).toEqual(onSelect.mock.calls[1]);
	selector.dispose();
});

test("navigation context restores the provider, search and selected identity", async () => {
	const fixture = providerSelectorFixture();
	const ui = { terminal: { rows: 24 }, requestRender: vi.fn() } as unknown as TUI;
	const first = new ModelSelectorComponent(
		ui,
		fixture.active,
		fixture.settings,
		fixture.registry,
		[],
		vi.fn(),
		vi.fn(),
	);
	await Bun.sleep(0);
	for (const character of "claude") first.handleInput(character);
	first.handleInput("\x1b[B");
	const context = first.getNavigationContext();
	const restored = new ModelSelectorComponent(
		ui,
		fixture.active,
		fixture.settings,
		fixture.registry,
		[],
		vi.fn(),
		vi.fn(),
		context,
	);
	await Bun.sleep(0);
	expect(restored.getNavigationContext()).toEqual(context);
	Object.assign(ui.terminal, { rows: 20 });
	restored.render(60);
	expect(restored.getNavigationContext()).toEqual(context);
	first.dispose();
	restored.dispose();
});
