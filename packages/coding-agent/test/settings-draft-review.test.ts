import { beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "../src/config/settings";
import { pluginSettingsStorage } from "../src/modes/components/plugin-settings-drafts";
import { getSettingsForTab } from "../src/modes/components/settings-defs";
import { SettingsSelectorComponent } from "../src/modes/components/settings-selector";
import { getCurrentThemeName, getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

test("plugin UI changes wait for combined review and persist only after confirmation", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-plugin-settings-uat-"));
	try {
		const destination = join(directory, "xcsh-plugins.lock.json");
		const original = {
			plugins: { example: { version: "1.0.0", enabled: true, enabledFeatures: null } },
			settings: { unrelated: { keep: true } },
		};
		await Bun.write(destination, JSON.stringify(original));
		const storage = pluginSettingsStorage(directory, {
			destination,
			list: async () => [
				{
					name: "example",
					path: join(directory, "example"),
					version: "1.0.0",
					manifest: { version: "1.0.0" },
					enabled: true,
					enabledFeatures: null,
				},
			],
		});
		const write = vi.spyOn(storage, "write");
		const changed = vi.fn();
		const close = vi.fn();
		const selector = new SettingsSelectorComponent(
			{
				settings: Settings.isolated(),
				pluginStorage: storage,
				availableThinkingLevels: [],
				thinkingLevel: undefined,
				availableThemes: [],
				cwd: directory,
			},
			{ onChange() {}, onCancel: close, onPluginsChanged: changed },
		);
		selector.handleInput("\x1b[Z"); // Appearance -> Plugins.
		for (let attempt = 0; attempt < 100 && !selector.render(100).join("\n").includes("example"); attempt++)
			await Bun.sleep(5);
		expect(selector.render(100).join("\n")).toContain("example");
		selector.handleInput("\r"); // Open plugin.
		expect(selector.render(100).join("\n")).toContain("Enabled");
		changeChoice(selector); // Explicit enabled=false draft.
		expect(await Bun.file(destination).json()).toEqual(original);
		expect(write).not.toHaveBeenCalled();
		selector.handleInput("\x13");
		expect(Bun.stripANSI(selector.render(100).join("\n"))).toContain("Review settings");
		selector.handleInput("\r"); // Cancel review.
		expect(await Bun.file(destination).json()).toEqual(original);
		selector.handleInput("\x13");
		selector.handleInput("\x1b[B");
		selector.handleInput("\r");
		for (let attempt = 0; attempt < 100 && !close.mock.calls.length; attempt++) await Bun.sleep(5);
		expect(close).toHaveBeenCalledTimes(1);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
		const reopened = await storage.load();
		expect(reopened.config.plugins.example.enabled).toBe(false);
		expect(reopened.config.settings.unrelated).toEqual({ keep: true });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

function changeChoice(selector: SettingsSelectorComponent) {
	selector.handleInput("\r");
	selector.handleInput("\x1b[B");
	selector.handleInput("\r");
}

test("settings changes stay drafts until cancel-first combined review is confirmed", async () => {
	const store = Settings.isolated();
	const write = vi.spyOn(store, "set");
	const change = vi.fn();
	const close = vi.fn();
	const saved = vi.fn();
	const selector = new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: ["xcsh-dark"],
			cwd: "/tmp",
			settings: store,
		},
		{ onChange: change, onCancel: close, onSaved: saved },
	);
	const defs = getSettingsForTab("appearance").filter(
		def => def.type !== "boolean" || !def.condition || def.condition(),
	);
	const index = defs.findIndex(def => def.type === "boolean");
	expect(index).toBeGreaterThanOrEqual(0);
	for (let i = 0; i < index; i++) selector.handleInput("\x1b[B");
	selector.handleInput("\r");
	expect(Bun.stripANSI(selector.render(80).join("\n"))).not.toContain("unsaved changes");
	selector.handleInput("\x1b[B");
	selector.handleInput("\r");
	expect(write).not.toHaveBeenCalled();
	expect(change).not.toHaveBeenCalled();
	selector.handleInput("\t");
	selector.handleInput("\x1b[Z");
	selector.handleInput("\x1b");
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("Keep editing");
	selector.handleInput("\r");
	expect(close).not.toHaveBeenCalled();
	selector.handleInput("\x13");
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("Review settings");
	selector.handleInput("\r"); // Cancel save.
	expect(write).not.toHaveBeenCalled();
	selector.handleInput("\x13");
	selector.handleInput("\x1b[B");
	selector.handleInput("\r");
	await Bun.sleep(0);
	expect(write).toHaveBeenCalledTimes(1);
	expect(change).toHaveBeenCalledTimes(1);
	expect(saved).toHaveBeenCalledWith(1, "settings");
	expect(close).toHaveBeenCalledTimes(1);
});

function draftFixture() {
	const store = Settings.isolated();
	const close = vi.fn();
	const changed = vi.fn();
	const preview = vi.fn();
	const write = vi.spyOn(store, "set");
	const selector = new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: ["xcsh-dark"],
			cwd: "/tmp",
			settings: store,
		},
		{ onChange: changed, onCancel: close, onThemePreview: preview },
	);
	const defs = getSettingsForTab("appearance").filter(
		def => def.type !== "boolean" || !def.condition || def.condition(),
	);
	const index = defs.findIndex(def => def.type === "boolean");
	for (let i = 0; i < index; i++) selector.handleInput("\x1b[B");
	return { store, close, changed, preview, write, selector };
}

test("discard restores preview and reverting a draft performs no write", async () => {
	const originalTheme = getCurrentThemeName();
	const first = draftFixture();
	changeChoice(first.selector);
	first.selector.handleInput("\x1b");
	first.selector.handleInput("\x1b[B");
	first.selector.handleInput("\r");
	await Bun.sleep(0);
	expect(first.write).not.toHaveBeenCalled();
	expect(first.preview).toHaveBeenCalledWith(originalTheme);
	expect(first.close).toHaveBeenCalledTimes(1);
	const reverted = draftFixture();
	changeChoice(reverted.selector);
	changeChoice(reverted.selector);
	reverted.selector.handleInput("\x1b");
	expect(reverted.write).not.toHaveBeenCalled();
	expect(reverted.close).toHaveBeenCalledTimes(1);
});

test("discard keeps drafts and remains open until failed preview restoration is retried", async () => {
	const fixture = draftFixture();
	fixture.preview.mockRejectedValueOnce(new Error("fixture theme unavailable"));
	changeChoice(fixture.selector);
	fixture.selector.handleInput("\x1b");
	fixture.selector.handleInput("\x1b[B");
	fixture.selector.handleInput("\r");
	fixture.selector.handleInput("\r");
	await Bun.sleep(0);
	expect(fixture.close).not.toHaveBeenCalled();
	expect(fixture.preview).toHaveBeenCalledTimes(1);
	expect(Bun.stripANSI(fixture.selector.render(80).join("\n"))).toContain("fixture theme unavailable");
	fixture.selector.handleInput("\r");
	await Bun.sleep(0);
	expect(fixture.close).toHaveBeenCalledTimes(1);
	expect(fixture.write).not.toHaveBeenCalled();
});

test("failed persistence retains review and retry does not repeat completed setters", async () => {
	const fixture = draftFixture();
	const flush = vi.spyOn(fixture.store, "flush").mockRejectedValueOnce(new Error("Fixture disk unavailable"));
	changeChoice(fixture.selector);
	fixture.selector.handleInput("\x13");
	fixture.selector.handleInput("\x1b[B");
	fixture.selector.handleInput("\r");
	fixture.selector.handleInput("\r"); // Duplicate submission while flushing.
	await Bun.sleep(0);
	expect(flush).toHaveBeenCalledTimes(1);
	expect(fixture.changed).not.toHaveBeenCalled();
	expect(fixture.close).not.toHaveBeenCalled();
	expect(Bun.stripANSI(fixture.selector.render(80).join("\n"))).toContain("Fixture disk unavailable");
	fixture.selector.handleInput("\x1b");
	expect(fixture.close).not.toHaveBeenCalled();
	fixture.selector.handleInput("\r");
	await Bun.sleep(0);
	expect(flush).toHaveBeenCalledTimes(2);
	expect(fixture.write).toHaveBeenCalledTimes(1);
	expect(fixture.changed).toHaveBeenCalledTimes(1);
	expect(fixture.close).toHaveBeenCalledTimes(1);
});

test("editable search survives tabs and nested cancellation; Escape clears it before leaving", async () => {
	const { selector, close, write } = draftFixture();
	selector.handleInput("statusLine");
	const before = Bun.stripANSI(selector.render(80).join("\n"));
	expect(before).toContain("Search:");
	expect(before).toContain("statusLine");
	selector.handleInput("\t");
	selector.handleInput("\x1b[Z");
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toBe(before);
	selector.handleInput("\r");
	selector.handleInput("\x1b");
	await Bun.sleep(0);
	expect(Bun.stripANSI(selector.render(80).join("\n"))).toBe(before);
	selector.handleInput("\x1b");
	expect(close).not.toHaveBeenCalled();
	selector.handleInput("\x1b");
	expect(close).toHaveBeenCalledTimes(1);
	expect(write).not.toHaveBeenCalled();
});

test("appearance settings keep the live status-line preview visible in the shared browser", () => {
	const selector = new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: ["xcsh-dark"],
			cwd: "/tmp",
			settings: Settings.isolated(),
		},
		{
			onChange() {},
			onCancel() {},
			getStatusLinePreview: () => "MODEL · 42% · /project",
		},
	);

	const rendered = Bun.stripANSI(selector.render(100).join("\n"));
	expect(rendered).toContain("Preview: MODEL · 42% · /project");
});

test("settings shows every section and restores Left/Right plus Space activation outside search", async () => {
	const selector = new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: ["xcsh-dark"],
			cwd: "/tmp",
			settings: Settings.isolated(),
		},
		{ onChange() {}, onCancel() {} },
	);
	const initial = Bun.stripANSI(selector.render(100).join("\n"));
	for (const label of [
		"Appearance",
		"Model",
		"Interaction",
		"Context",
		"Editing",
		"Tools",
		"Tasks",
		"Providers",
		"Sandbox",
		"Plugins",
	])
		expect(initial).toContain(label);
	selector.handleInput("\x1b[C");
	expect(Bun.stripANSI(selector.render(100).join("\n"))).toContain("Model");
	selector.handleInput("\x1b[D");
	selector.handleInput(" ");
	await Bun.sleep(0);
	expect(Bun.stripANSI(selector.render(100).join("\n"))).toContain("Choose a draft value");
});
