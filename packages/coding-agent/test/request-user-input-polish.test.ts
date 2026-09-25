import { afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { setKeybindings, type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import { RequestUserInputComponent } from "../src/modes/components/request-user-input";
import { getThemeByName, setSymbolPreset, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
afterEach(() => setKeybindings(KeybindingsManager.inMemory()));

function tui(columns: number, rows: number): TUI {
	return {
		requestRender: vi.fn(),
		setFocus: vi.fn(),
		terminal: { columns, rows },
	} as unknown as TUI;
}

const questions = [
	{
		id: "scope",
		header: "Scope",
		question: "Which deployment scope should xcsh use for Montréal and 東京? ".repeat(3),
		options: [
			{ label: "Focused", description: "Change only the selected project." },
			{ label: "Complete", description: "" },
		],
		isOther: true,
	},
	{
		id: "token",
		header: "Credential",
		question: "Enter the temporary token",
		options: null,
		isSecret: true,
	},
] as const;

describe("question TUI polish", () => {
	test("uses the shared responsive frame across themes, symbols, and supported terminal sizes", async () => {
		for (const themeName of ["xcsh-dark", "xcsh-light"])
			for (const symbols of ["unicode", "ascii"] as const)
				for (const [columns, rows] of [
					[60, 20],
					[80, 24],
					[100, 32],
					[140, 40],
				] as const) {
					setThemeInstance((await getThemeByName(themeName))!);
					await setSymbolPreset(symbols);
					const component = new RequestUserInputComponent(
						tui(columns, rows),
						questions,
						vi.fn(),
						new AbortController().signal,
					);
					const lines = component.render(columns);
					const plain = Bun.stripANSI(lines.join("\n"));
					expect(lines.length).toBeLessThanOrEqual(rows);
					expect(lines.every(line => visibleWidth(line) === Math.min(columns, 100))).toBe(true);
					expect(plain).toContain("Answer questions");
					expect(plain).toContain("Question 1 of 2");
					expect(plain).toContain("Scope");
					expect(plain).toContain("Montréal");
					expect(plain).not.toContain("Complete\n   ");
				}
	});

	test("distinguishes highlighted, committed, and cleared choices and preserves numbered submission", async () => {
		await setSymbolPreset("ascii");
		const done = vi.fn();
		const component = new RequestUserInputComponent(tui(80, 24), [questions[0]], done, new AbortController().signal);
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("> [ ] 1. Focused");
		component.handleInput(" ");
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("> [x] 1. Focused");
		component.handleInput("\x7f");
		expect(Bun.stripANSI(component.render(80).join("\n"))).not.toContain("[x]");
		component.handleInput("2");
		expect(done).toHaveBeenCalledWith({ answers: { scope: { answers: ["Complete"] } } });
	});

	test("shows one question at a time, advances automatically, and only exposes overflow help when needed", async () => {
		await setSymbolPreset("unicode");
		const component = new RequestUserInputComponent(tui(60, 20), questions, vi.fn(), new AbortController().signal);
		const first = Bun.stripANSI(component.render(60).join("\n"));
		expect(first).toContain("Which deployment scope");
		expect(first).not.toContain("Enter the temporary token");
		expect(first).not.toContain("scroll choices");
		component.handleInput("\r");
		const second = Bun.stripANSI(component.render(60).join("\n"));
		expect(second).toContain("Question 2 of 2");
		expect(second).toContain("Enter the temporary token");

		const crowded = new RequestUserInputComponent(
			tui(60, 20),
			[
				{
					id: "crowded",
					header: "Crowded",
					question: "Keep the current choice visible",
					options: Array.from({ length: 9 }, (_, index) => ({
						label: `Choice ${index + 1}`,
						description: `Description ${index + 1}`,
					})),
				},
			],
			vi.fn(),
			new AbortController().signal,
		);
		for (let index = 0; index < 8; index++) crowded.handleInput("\x1b[B");
		const overflow = Bun.stripANSI(crowded.render(60).join("\n"));
		expect(overflow).toContain("Choice 9");
		expect(overflow).toContain("scroll choices");
	});

	test("uses remapped selector and interrupt bindings", () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"app.interrupt": "alt+i",
				"tui.select.cancel": "alt+x",
				"tui.select.confirm": "alt+enter",
			}),
		);
		const done = vi.fn();
		const component = new RequestUserInputComponent(tui(80, 24), [questions[0]], done, new AbortController().signal);
		const plain = Bun.stripANSI(component.render(80).join("\n"));
		expect(plain).toContain("alt+enter submit");
		expect(plain).toContain("Alt+X:");
		expect(plain).toContain("interrupt");
		component.handleInput("\x1b");
		expect(done).not.toHaveBeenCalled();
		component.handleInput("\x1bx");
		expect(done).toHaveBeenCalledWith(undefined);
	});

	test("wraps question prompts and option descriptions rather than truncating them", async () => {
		await setSymbolPreset("unicode");
		const prompt =
			"After the X-Content-Type-Options canary proves Compromised, what should happen if a later header is missing?";
		const description =
			"Restore the canonical cohort, record the header as not triggered within its window, and continue the remaining checks.";
		const component = new RequestUserInputComponent(
			tui(60, 24),
			[
				{
					id: "suite-failures",
					header: "Suite failures",
					question: prompt,
					options: [{ label: "Continue and record", description }],
				},
			],
			vi.fn(),
			new AbortController().signal,
		);
		const rendered = Bun.stripANSI(component.render(60).join("\n"))
			.replace(/[╭─╮│├┤╰╯]/g, "")
			.replace(/\s+/g, " ");
		expect(rendered).toContain("what should happen if a later header is missing?");
		expect(rendered).toContain("record the header as not triggered within its window");
		expect(rendered).toContain("continue the remaining checks.");
	});
	test("keeps notes and masked secrets inside the frame", async () => {
		await setSymbolPreset("unicode");
		const done = vi.fn();
		const component = new RequestUserInputComponent(tui(60, 20), [questions[1]], done, new AbortController().signal);
		component.handleInput("sëcret-🙂");
		const rendered = Bun.stripANSI(component.render(60).join("\n"));
		expect(rendered).toContain("Type your answer");
		expect(rendered).toContain("********");
		expect(rendered).not.toContain("sëcret-🙂");
		expect(rendered.split("\n").every(line => visibleWidth(line) === 60)).toBe(true);
		component.handleInput("\r");
		expect(done).toHaveBeenCalledWith({ answers: { token: { answers: ["user_note: sëcret-🙂"] } } });
	});

	test("renders unanswered confirmation in the same frame with Proceed selected by default", async () => {
		await setSymbolPreset("unicode");
		const component = new RequestUserInputComponent(tui(80, 24), questions, vi.fn(), new AbortController().signal);
		component.handleInput("\r");
		component.handleInput("\r");
		const lines = component.render(80);
		const plain = Bun.stripANSI(lines.join("\n"));
		expect(plain).toContain("Submit answers?");
		expect(plain).toContain("1 unanswered question");
		expect(plain).toContain("❯ 1. Proceed");
		expect(lines.every(line => visibleWidth(line) === 80)).toBe(true);
	});
});
