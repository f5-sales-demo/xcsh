import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { getKeybindings, setKeybindings } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import { ContextPicker } from "../src/modes/components/context-picker";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

const originalKeys = getKeybindings();
afterEach(() => setKeybindings(originalKeys));
beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const choices = ["local", "global"].map(source => ({
	target: { name: "demo", source: source as "local" | "global" },
	context: {
		name: "demo",
		apiUrl: `https://${source}.example.test`,
		apiToken: "synthetic-private",
		defaultNamespace: source,
	},
}));
describe("context picker", () => {
	it("Enter selects the active source and never shows secrets", () => {
		let result: unknown;
		const picker = new ContextPicker(choices, { name: "demo", source: "global" }, value => {
			result = value;
		});
		expect(picker.render(80).join("\n")).not.toContain("synthetic-private");
		picker.handleInput("\r");
		expect(result).toEqual({ target: { name: "demo", source: "global" }, action: "activate" });
	});
	it("filters endpoint, retains identity across refresh, and opens actions", () => {
		let result: unknown;
		const picker = new ContextPicker(choices, null, value => {
			result = value;
		});
		picker.handleInput("global");
		picker.refresh([...choices].reverse());
		picker.handleInput("\x0f");
		expect(result).toEqual({ target: { name: "demo", source: "global" }, action: "actions" });
	});
	it.each([
		[60, 20],
		[80, 24],
		[120, 40],
	])("renders within %jx%j", (width, height) => {
		const picker = new ContextPicker(
			choices,
			null,
			() => {},
			() => height,
		);
		const lines = picker.render(width);
		expect(lines.length).toBeLessThanOrEqual(height);
		for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
	});
	it("empty results offer creation and clearing; unavailable targets cannot activate", () => {
		let result: unknown;
		const picker = new ContextPicker(
			[{ target: { name: "bad", source: "global" }, error: "Upgrade required" }],
			null,
			value => {
				result = value;
			},
		);
		picker.handleInput("\r");
		expect(result).toBeUndefined();
		expect(Bun.stripANSI(picker.render(80).join("\n"))).toContain("Upgrade required");
		picker.handleInput("missing");
		const text = Bun.stripANSI(picker.render(80).join("\n"));
		expect(text).toContain("Create context");
		expect(text).toContain("Clear search");
	});
});

it("restores filtered source identity when returning from actions", () => {
	let result: unknown;
	const picker = new ContextPicker(choices, null, () => {});
	picker.handleInput("global");
	const state = picker.state;
	const reopened = new ContextPicker(
		choices,
		null,
		value => {
			result = value;
		},
		() => 24,
		state,
	);
	reopened.handleInput("\r");
	expect(result).toEqual({ target: { name: "demo", source: "global" }, action: "activate" });
});

it("honors custom actions and navigation and renders both themes at each viewport", async () => {
	const keys = KeybindingsManager.inMemory({ "app.context.actions": "ctrl+x", "tui.select.down": "ctrl+j" });
	setKeybindings(keys);
	let result: unknown;
	const picker = new ContextPicker(choices, null, value => {
		result = value;
	});
	picker.handleInput("\x0a");
	picker.handleInput("\x18");
	expect(result).toEqual({ target: { name: "demo", source: "global" }, action: "actions" });
	for (const name of ["xcsh-dark", "xcsh-light"]) {
		setThemeInstance((await getThemeByName(name))!);
		for (const [width, height] of [
			[60, 20],
			[80, 24],
			[120, 40],
		]) {
			const frame = new ContextPicker(
				choices,
				null,
				() => {},
				() => height,
			).render(width);
			expect(frame.length).toBeLessThanOrEqual(height);
			for (const line of frame) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
		}
	}
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
});
