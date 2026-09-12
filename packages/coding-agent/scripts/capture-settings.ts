import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Settings } from "../src/config/settings";
import type { PluginManager } from "../src/extensibility/plugins/manager";
import type { InstalledPlugin } from "../src/extensibility/plugins/types";
import { PluginDetailComponent, PluginListComponent } from "../src/modes/components/plugin-settings";
import { getSettingsForTab } from "../src/modes/components/settings-defs";
import { SettingsSelectorComponent } from "../src/modes/components/settings-selector";
import { getCurrentThemeName, setSymbolPreset, setTheme } from "../src/modes/theme/theme";
import { writeTerminalCapture } from "./terminal-capture";

const root = resolve(import.meta.dir, "../../..");
const output = await mkdtemp(join(tmpdir(), "xcsh-settings-captures-"));
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
const diff = Bun.spawnSync(["git", "diff", "--binary", "HEAD"], { cwd: root });
if (revision.exitCode || diff.exitCode) throw new Error("Cannot establish source provenance");
const hash = createHash("sha256").update(diff.stdout);
for (const pattern of [
	"packages/coding-agent/src/modes/**/*.ts",
	"packages/tui/src/**/*.ts",
	"packages/coding-agent/scripts/*capture*.ts",
])
	for (const file of [...new Bun.Glob(pattern).scanSync({ cwd: root })].sort())
		hash.update(file).update(await Bun.file(join(root, file)).bytes());
const fingerprint = hash.digest("hex");
const fixture: InstalledPlugin = {
	name: "example-observability",
	version: "1.2.0",
	path: "/synthetic/plugins/example-observability",
	enabled: true,
	enabledFeatures: null,
	manifest: {
		version: "1.2.0",
		description: "Synthetic plugin for local acceptance captures. No account or service is contacted.",
		settings: {
			token: { type: "string", secret: true, description: "Synthetic token; never reveal its contents." },
			limit: { type: "number", min: 1, max: 10, default: 2, description: "Maximum synthetic entries per report." },
		},
	},
};
let count = 0;
for (const themeName of ["xcsh-dark", "xcsh-light"])
	for (const symbols of ["unicode", "ascii"] as const)
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			await setSymbolPreset(symbols);
			const result = await setTheme(themeName);
			if (!result.success || getCurrentThemeName() !== themeName)
				throw new Error(`Incorrect capture theme: ${themeName}`);
			Object.defineProperty(process.stdout, "rows", { configurable: true, value: rows });
			const settings = new SettingsSelectorComponent(
				{
					settings: Settings.isolated(),
					availableThinkingLevels: [],
					thinkingLevel: undefined,
					availableThemes: ["xcsh-dark", "xcsh-light"],
					cwd: "/synthetic",
				},
				{ onChange() {}, onCancel() {} },
			);
			const screens: Array<{ name: string; lines: string[]; actions: string[] }> = [
				{ name: "settings-browse", lines: settings.render(columns), actions: ["open /settings"] },
			];
			const defs = getSettingsForTab("appearance").filter(
				def => def.type !== "boolean" || !def.condition || def.condition(),
			);
			const index = defs.findIndex(def => def.type === "boolean");
			if (index < 0) throw new Error("Missing boolean fixture target");
			for (let i = 0; i < index; i++) settings.handleInput("\x1b[B");
			for (const key of ["\r", "\x1b[B", "\r", "\x13"]) settings.handleInput(key);
			screens.push({
				name: "settings-review",
				lines: settings.render(columns),
				actions: ["open /settings", `open ${defs[index].path}`, "choose other boolean value", "Ctrl+S"],
			});
			const plugins = new PluginListComponent([fixture], { onPluginSelect() {}, onCancel() {} });
			screens.push({
				name: "plugin-settings-browse",
				lines: plugins.render(columns),
				actions: ["open settings Plugins tab"],
			});
			const detail = new PluginDetailComponent(
				fixture,
				{} as PluginManager,
				{ onBack() {}, onEnabledChange() {}, onFeatureChange() {}, onConfigChange() {} },
				{ token: "synthetic-redacted", limit: 2 },
			);
			screens.push({
				name: "plugin-settings-detail",
				lines: detail.render(columns),
				actions: ["open synthetic plugin"],
			});
			for (const screen of screens) {
				const name = `${screen.name}-${columns}x${rows}-${themeName}-${symbols}`;
				await writeTerminalCapture(
					output,
					name,
					screen.lines,
					{ columns, rows },
					themeName === "xcsh-dark"
						? { foreground: "#d8dee9", background: "#1f2430" }
						: { foreground: "#2e3440", background: "#f7f7f5" },
					{
						fixture: "settings-synthetic-v1",
						theme: themeName,
						symbols,
						actions: screen.actions,
						expected: "bounded frame; selected row reachable; no secrets exposed",
						observed: { activeTheme: getCurrentThemeName(), renderedRows: screen.lines.length },
						revision: revision.stdout.toString().trim(),
						fingerprint,
						fingerprintScope: "tracked diff plus mode/TUI/capture source",
						persistenceProof: false,
					},
				);
				count++;
			}
		}
console.log(JSON.stringify({ output, captures: count, fingerprint }));
