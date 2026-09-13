import { beforeAll, expect, test, vi } from "bun:test";
import type { PluginManager } from "../src/extensibility/plugins/manager";
import type { InstalledPlugin } from "../src/extensibility/plugins/types";
import { PluginDetailComponent, PluginListComponent } from "../src/modes/components/plugin-settings";
import { SettingsChoiceEditor, SettingsTextEditor } from "../src/modes/components/settings-editors";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const options = [
	{ value: "first", label: "First value" },
	{ value: "second", label: "Second value" },
];

test("choice search is editable, supports paste, and clears before closing", () => {
	const select = vi.fn();
	const cancel = vi.fn();
	const editor = new SettingsChoiceEditor("Example", "Description", options, "second", select, cancel);
	editor.handleInput("\x1b[200~First value\x1b[201~");
	expect(Bun.stripANSI(editor.render(60).join("\n"))).not.toContain("Second value");
	editor.handleInput("\x1b");
	expect(cancel).not.toHaveBeenCalled();
	expect(Bun.stripANSI(editor.render(60).join("\n"))).toContain("Second value (current)");
	editor.handleInput("\r");
	expect(select).toHaveBeenCalledWith("second");
});

test("choice editor restores legacy Space, paging, and mouse controls when search is empty", async () => {
	const values = Array.from({ length: 12 }, (_, index) => ({ value: `value-${index}`, label: `Value ${index}` }));
	const select = vi.fn();
	const preview = vi.fn();
	const editor = new SettingsChoiceEditor("Example", "Description", values, "value-0", select, vi.fn(), preview);
	let rendered = editor.render(80);
	expect(Bun.stripANSI(rendered.join("\n"))).toContain("Choices 1/12");
	editor.handleInput("\x1b[6~");
	expect(Bun.stripANSI(editor.render(80).join("\n"))).toContain("Choices 9/12");
	rendered = editor.render(80);
	const thirdRow = rendered.findIndex(line => Bun.stripANSI(line).includes("Value 3"));
	expect(thirdRow).toBeGreaterThanOrEqual(0);
	editor.routeMouse(
		{ button: 32, col: 0, row: thirdRow, release: false, wheel: null, motion: true, leftClick: false },
		thirdRow,
		0,
	);
	editor.routeMouse({ button: 65, col: 0, row: 0, release: false, wheel: 1, motion: false, leftClick: false }, 0, 0);
	await Bun.sleep(0);
	expect(preview).toHaveBeenCalled();
	const clickRow = editor.render(80).findIndex(line => Bun.stripANSI(line).includes("Value 5"));
	expect(clickRow).toBeGreaterThanOrEqual(0);
	editor.routeMouse(
		{ button: 0, col: 0, row: clickRow, release: false, wheel: null, motion: false, leftClick: true },
		clickRow,
		0,
	);
	await Bun.sleep(0);
	expect(select).toHaveBeenCalledWith("value-5");
	const activate = new SettingsChoiceEditor("Example", "", values.slice(0, 2), "value-0", select, vi.fn());
	activate.handleInput(" ");
	await Bun.sleep(0);
	expect(select).toHaveBeenCalledWith("value-0");
});

test("cancellation waits for active preview and drops queued stale previews before rollback", async () => {
	const pending = Promise.withResolvers<void>();
	const events: string[] = [];
	const preview = async (value: string) => {
		events.push(`start:${value}`);
		await pending.promise;
		events.push(`end:${value}`);
	};
	const select = vi.fn();
	const editor = new SettingsChoiceEditor(
		"Example",
		"",
		options,
		"first",
		select,
		() => {
			events.push("restore:first");
		},
		preview,
	);
	editor.handleInput("\x1b[B");
	await Bun.sleep(0);
	editor.handleInput("\x1b[A");
	editor.handleInput("\x1b");
	editor.handleInput("\r");
	expect(events).toEqual(["start:second"]);
	pending.resolve();
	await Bun.sleep(0);
	expect(events).toEqual(["start:second", "end:second", "restore:first"]);
	expect(select).not.toHaveBeenCalled();
});

test("failed rollback retains the editor for retry", async () => {
	const cancel = vi.fn().mockRejectedValueOnce(new Error("fixture restore failure")).mockResolvedValue(undefined);
	const editor = new SettingsChoiceEditor("Example", "", options, "first", vi.fn(), cancel);
	editor.handleInput("\x1b");
	await Bun.sleep(0);
	expect(Bun.stripANSI(editor.render(80).join("\n"))).toContain("fixture restore failure");
	editor.handleInput("\x1b");
	await Bun.sleep(0);
	expect(cancel).toHaveBeenCalledTimes(2);
});

test("text editor prefills and cancels without submitting", () => {
	const submit = vi.fn();
	const cancel = vi.fn();
	const editor = new SettingsTextEditor("Destination", "Draft only", "previous", submit, cancel);
	expect(Bun.stripANSI(editor.render(60).join("\n"))).toContain("previous");
	editor.handleInput("-draft");
	editor.handleInput("\x1b");
	expect(cancel).toHaveBeenCalledTimes(1);
	expect(submit).not.toHaveBeenCalled();
});

test("plugin secret input and saved draft row remain masked", () => {
	const plugin: InstalledPlugin = {
		name: "example",
		version: "1.0",
		path: "/fixture/example",
		enabled: true,
		enabledFeatures: null,
		manifest: { version: "1.0", settings: { token: { type: "string", secret: true } } },
	};
	const change = vi.fn();
	const detail = new PluginDetailComponent(
		plugin,
		{} as PluginManager,
		{ onEnabledChange() {}, onFeatureChange() {}, onConfigChange: change, onBack() {} },
		{ token: "old-synthetic-secret" },
	);
	detail.handleInput("token");
	detail.handleInput("\r");
	detail.handleInput("new-synthetic-secret");
	expect(Bun.stripANSI(detail.render(80).join("\n"))).not.toContain("synthetic-secret");
	detail.handleInput("\r");
	expect(change).toHaveBeenCalledWith("token", "new-synthetic-secret");
	expect(Bun.stripANSI(detail.render(80).join("\n"))).not.toContain("synthetic-secret");
});

test("plugin list preserves scoped identity and search when refreshed", () => {
	const base: InstalledPlugin = {
		name: "example",
		version: "1.0",
		path: "/fixture/first",
		enabled: true,
		enabledFeatures: null,
		manifest: { version: "1.0" },
	};
	const second = { ...base, path: "/fixture/second" };
	const open = vi.fn();
	const list = new PluginListComponent([base, second], { onPluginSelect: open, onCancel() {} });
	list.handleInput("example");
	list.handleInput("\x1b[B");
	list.updatePlugins([second, base]);
	list.handleInput("\r");
	expect(open).toHaveBeenCalledWith(second);
	expect(Bun.stripANSI(list.render(80).join("\n"))).toContain("Search: > example");
});

test("text validation failure retains editable content and masked failures do not disclose values", () => {
	const editor = new SettingsTextEditor(
		"Limit",
		"",
		"",
		() => {
			throw new Error("Enter a finite number");
		},
		vi.fn(),
	);
	editor.handleInput("invalid");
	editor.handleInput("\r");
	expect(Bun.stripANSI(editor.render(60).join("\n"))).toContain("Enter a finite number");
	expect(Bun.stripANSI(editor.render(60).join("\n"))).toContain("invalid");
	const secret = new SettingsTextEditor(
		"Token",
		"",
		"",
		value => {
			throw new Error(value);
		},
		vi.fn(),
		{ masked: true },
	);
	secret.handleInput("synthetic-secret");
	secret.handleInput("\r");
	expect(Bun.stripANSI(secret.render(60).join("\n"))).not.toContain("synthetic-secret");
	expect(Bun.stripANSI(secret.render(60).join("\n"))).toContain("Could not apply");
});
