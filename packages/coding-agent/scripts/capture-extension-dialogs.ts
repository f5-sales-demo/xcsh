import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Component, TUI } from "@f5-sales-demo/pi-tui";
import { createDashboardController } from "../src/autoresearch/dashboard";
import { createSessionRuntime } from "../src/autoresearch/state";
import { KeybindingsManager } from "../src/config/keybindings";
import type { ExtensionContext, ExtensionUiComponent } from "../src/extensibility/extensions";
import { HookEditorComponent } from "../src/modes/components/hook-editor";
import { HookInputComponent } from "../src/modes/components/hook-input";
import { HookSelectorComponent } from "../src/modes/components/hook-selector";
import { getCurrentThemeName, setSymbolPreset, setTheme, theme } from "../src/modes/theme/theme";
import { writeTerminalCapture } from "./terminal-capture";

const root = resolve(import.meta.dir, "../../..");
const output = resolve(process.argv[2] ?? join(root, "packages/coding-agent/test/evidence/extension-dialogs-v1"));
await mkdir(output, { recursive: true });
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
const diff = Bun.spawnSync(["git", "diff", "--binary", "HEAD"], { cwd: root });
if (revision.exitCode || diff.exitCode) throw new Error("Cannot establish capture provenance");
const hash = createHash("sha256").update(diff.stdout);
for (const file of [
	"packages/coding-agent/src/autoresearch/dashboard.ts",
	"packages/coding-agent/src/modes/components/hook-editor.ts",
	"packages/coding-agent/src/modes/components/hook-input.ts",
	"packages/coding-agent/src/modes/components/hook-selector.ts",
	"packages/coding-agent/src/modes/components/selector-frame.ts",
	"packages/coding-agent/scripts/capture-extension-dialogs.ts",
])
	hash.update(file).update(await Bun.file(join(root, file)).bytes());
const fingerprint = hash.digest("hex");
let captures = 0;

for (const themeName of ["xcsh-dark", "xcsh-light"])
	for (const symbols of ["unicode", "ascii"] as const)
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			await setSymbolPreset(symbols);
			if (!(await setTheme(themeName)).success || getCurrentThemeName() !== themeName)
				throw new Error("Wrong capture theme");
			const tui = { requestRender() {}, terminal: { columns, rows }, start() {}, stop() {} } as unknown as TUI;
			const scenarios: Array<{ name: string; component: Component; purpose: string }> = [
				{
					name: "confirmation",
					component: new HookSelectorComponent(
						"Deploy\nTarget: staging\nScope: deployment\nState: pending → deployed\nConsequence: remote traffic may change.",
						["No", "Yes"],
						() => {},
						() => {},
						{ tui },
					),
					purpose: "Cancel-first extension confirmation",
				},
				{
					name: "review-mode",
					component: new HookSelectorComponent(
						"Review Mode",
						[
							"1. Review against a base branch (PR Style)",
							"2. Review uncommitted changes",
							"3. Review a specific commit",
							"4. Custom review instructions",
						],
						() => {},
						() => {},
						{ tui },
					),
					purpose: "review mode selection",
				},
				{
					name: "review-branch",
					component: new HookSelectorComponent(
						"Select base branch to compare against",
						["main", "feature/tui-style-guide-complete-candidate", "release/v21"],
						() => {},
						() => {},
						{ tui },
					),
					purpose: "base branch selection",
				},
				{
					name: "review-commit",
					component: new HookSelectorComponent(
						"Select commit to review",
						["abc1234 keep shared dialog behavior", "def5678 preserve callback contracts"],
						() => {},
						() => {},
						{ tui },
					),
					purpose: "commit selection",
				},
				{
					name: "review-editor",
					component: new HookEditorComponent(
						tui,
						"Enter custom review instructions",
						"Review lifecycle, retry, and narrow-terminal behavior.",
						() => {},
						() => {},
					),
					purpose: "custom review instructions",
				},
				{
					name: "native-input",
					component: new HookInputComponent(
						"Native lifecycle continuation",
						"Enter the continuation label",
						() => {},
						() => {},
						{ tui },
					),
					purpose: "native lifecycle continuation input",
				},
			];

			const runtime = createSessionRuntime();
			runtime.autoresearchMode = true;
			runtime.state.name = "synthetic optimization";
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
			let overlay: ExtensionUiComponent | undefined;
			const ctx = {
				hasUI: true,
				ui: {
					custom: async <T>(
						factory: (
							tuiArg: TUI,
							themeArg: typeof theme,
							keybindings: KeybindingsManager,
							done: (result: T) => void,
						) => ExtensionUiComponent,
					): Promise<T> => {
						return await new Promise<T>(resolve => {
							overlay = factory(tui, theme, KeybindingsManager.inMemory(), resolve);
							resolve(undefined as T);
						});
					},
				},
			} as unknown as ExtensionContext;
			await createDashboardController().showOverlay(ctx, runtime);
			if (!overlay) throw new Error("Autoresearch overlay was not created");
			scenarios.push({ name: "autoresearch-overlay", component: overlay, purpose: "extension-owned dashboard" });

			for (const scenario of scenarios) {
				const lines = scenario.component.render(columns);
				await writeTerminalCapture(
					output,
					`${scenario.name}-${columns}x${rows}-${themeName}-${symbols}`,
					lines,
					{ columns, rows },
					themeName === "xcsh-dark"
						? { foreground: "#d8dee9", background: "#1f2430" }
						: { foreground: "#2e3440", background: "#f7f7f5" },
					{
						fixture: "extension-dialogs-v1",
						theme: themeName,
						symbols,
						state: scenario.name,
						purpose: scenario.purpose,
						revision: revision.stdout.toString().trim(),
						fingerprint,
						fingerprintScope: "tracked diff plus extension dialog components and capture source",
						persistenceProof: "read-only or ephemeral input; no persistent mutation",
						visualVerdict: "unexamined",
					},
				);
				captures++;
			}
			overlay.dispose?.();
		}

console.log(JSON.stringify({ captures, fingerprint, output }));
