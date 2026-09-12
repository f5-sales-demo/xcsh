import { beforeAll, expect, test, vi } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { Container, Input, Text, visibleWidth } from "@f5-sales-demo/pi-tui";
import { ModelSelectorComponent } from "../src/modes/components/model-selector";
import { OAuthSelectorComponent } from "../src/modes/components/oauth-selector";
import { ConnectionChoiceComponent, ConnectionInputComponent } from "../src/modes/components/selector-frame";
import { getLoginOptions } from "../src/modes/controllers/login-options";
import { getThemeByName, setSymbolPreset, setThemeInstance } from "../src/modes/theme/theme";
import type { AuthStorage } from "../src/session/auth-storage";
import { providerSelectorFixture } from "./helpers/provider-selector-fixture";

beforeAll(async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
});
test("provider paging hints appear only while the catalog overflows", () => {
	const create = (catalogProviders: ReturnType<typeof getLoginOptions>) =>
		new OAuthSelectorComponent("login", { hasAuth: () => false } as unknown as AuthStorage, vi.fn(), vi.fn(), {
			rows: () => 20,
			initialCatalog: true,
			catalogProviders,
		});
	const catalog = create(getLoginOptions());
	expect(Bun.stripANSI(catalog.render(60).join("\n"))).toContain("Pageup/Pagedown: page");
	catalog.handleInput("\x1b[6~");
	expect(Bun.stripANSI(catalog.render(60).join("\n"))).toContain("(11/");
	const small = create([{ id: "anthropic", name: "Anthropic", kind: "oauth", available: true }]);
	expect(Bun.stripANSI(small.render(60).join("\n"))).not.toContain(": page");
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
					expect(lines.every(line => visibleWidth(line) === Math.min(100, columns))).toBe(true);
					const plainLines = lines.map(line => Bun.stripANSI(line));
					const expected =
						symbols === "ascii"
							? {
									topLeft: "+",
									topRight: "+",
									bottomLeft: "+",
									bottomRight: "+",
									vertical: "|",
									teeLeft: "+",
									teeRight: "+",
								}
							: {
									topLeft: "╭",
									topRight: "╮",
									bottomLeft: "╰",
									bottomRight: "╯",
									vertical: "│",
									teeLeft: "├",
									teeRight: "┤",
								};
					expect(plainLines[0]?.startsWith(expected.topLeft)).toBe(true);
					expect(plainLines[0]?.endsWith(expected.topRight)).toBe(true);
					expect(plainLines.at(-1)?.startsWith(expected.bottomLeft)).toBe(true);
					expect(plainLines.at(-1)?.endsWith(expected.bottomRight)).toBe(true);
					expect(
						plainLines
							.slice(1, -1)
							.every(line => line.startsWith(expected.vertical) || line.startsWith(expected.teeLeft)),
					).toBe(true);
					expect(
						plainLines
							.slice(1, -1)
							.every(line => line.endsWith(expected.vertical) || line.endsWith(expected.teeRight)),
					).toBe(true);
					expect(Bun.stripANSI(lines.join("\n"))).not.toContain("Enter:");
					return Bun.stripANSI(lines.join("\n"));
				};
				expect(check(selector)).toContain("litellm/gpt-5.6-sol");
				selector.handleInput("\r");
				expect(check(selector)).toContain("Save as default");
				selector.handleInput("\r");
				expect(check(selector)).toContain("Reasoning");
				selector.handleInput("\x1b");
				selector.handleInput("\x1b[B");
				selector.handleInput("\x1b[B");
				selector.handleInput("\r");
				expect(check(selector)).toContain("Choose a specialist role");
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
				const management = new OAuthSelectorComponent(
					"login",
					{ hasAuth: () => true } as unknown as AuthStorage,
					vi.fn(),
					vi.fn(),
					{
						rows: () => rows,
						providers: [{ id: "openai-codex", name: "ChatGPT", kind: "oauth", available: true }],
						onChooseModel: vi.fn(),
						getAccessState: providerId => ({
							provider: providerId,
							configured: true,
							credentialSource: "stored-oauth",
							status: "connected",
							catalogFreshness: "fresh",
							selectable: true,
						}),
					},
				);
				management.handleInput("\r");
				expect(check(management)).toContain("Manage ChatGPT");
				const result = new ConnectionChoiceComponent(
					"Connection saved",
					"LiteLLM · Credentials saved; discovery unavailable",
					[
						{ label: "Retry connection", description: "Check this saved connection again." },
						{ label: "Browse models", description: "Choose from this provider's catalog." },
						{ label: "Done", description: "Keep the current model settings." },
					],
					vi.fn(),
					vi.fn(),
					() => rows,
				);
				expect(check(result)).toContain("Retry connection");
				const input = new Input();
				input.setMasked(true);
				input.setValue("synthetic-secret");
				const authContent = new Container();
				authContent.addChild(new Text("Open sign-in page on another device.", 0, 0));
				const auth = new ConnectionInputComponent(
					"Sign in to ChatGPT",
					"Paste the redirect URL or authorization code",
					input,
					() => rows,
					authContent,
				);
				const authText = check(auth);
				expect(authText).toContain("Open sign-in page");
				expect(authText).not.toContain("synthetic-secret");
				provider.stopValidation();
				management.stopValidation();
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
