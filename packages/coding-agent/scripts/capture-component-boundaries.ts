import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ReasoningEffort } from "@f5-sales-demo/pi-ai";
import {
	Box,
	CancellableLoader,
	type Component,
	Editor,
	Image,
	Input,
	Markdown,
	SelectList,
	TabBar,
	Text,
	TruncatedText,
	type TUI,
} from "@f5-sales-demo/pi-tui";
import type { Rule } from "../src/capability/rule";
import { KeybindingsManager } from "../src/config/keybindings";
import { BranchSummaryMessageComponent } from "../src/modes/components/branch-summary-message";
import { CompactionSummaryMessageComponent } from "../src/modes/components/compaction-summary-message";
import { CustomMessageComponent } from "../src/modes/components/custom-message";
import { HookMessageComponent } from "../src/modes/components/hook-message";
import { appKeyHint, rawKeyHint } from "../src/modes/components/keybinding-hints";
import { LiteLLMModelSelectorComponent } from "../src/modes/components/litellm-model-selector";
import { PlanPreviewComponent } from "../src/modes/components/plan-preview";
import { QueueModeSelectorComponent } from "../src/modes/components/queue-mode-selector";
import { selectorFrame, selectorFrameContentWidth } from "../src/modes/components/selector-frame";
import { ShowImagesSelectorComponent } from "../src/modes/components/show-images-selector";
import { SkillMessageComponent } from "../src/modes/components/skill-message";
import { ThemeSelectorComponent } from "../src/modes/components/theme-selector";
import { ThinkingSelectorComponent } from "../src/modes/components/thinking-selector";
import { TranscriptNoticeComponent } from "../src/modes/components/transcript-notice";
import { TtsrNotificationComponent } from "../src/modes/components/ttsr-notification";
import { VllmModelSelectorComponent } from "../src/modes/components/vllm-model-selector";
import { LITELLM_LOGIN_MODEL_CHOICES } from "../src/modes/controllers/login-model";
import {
	getCurrentThemeName,
	getEditorTheme,
	getMarkdownTheme,
	getSelectListTheme,
	setSymbolPreset,
	setTheme,
	theme,
} from "../src/modes/theme/theme";
import { writeTerminalCapture } from "./terminal-capture";

class FramedComponent implements Component {
	constructor(
		private readonly title: string,
		private readonly purpose: string,
		private readonly component: Component,
		private readonly rows: number,
	) {}

	render(width: number): string[] {
		const body = this.component.render(selectorFrameContentWidth(width));
		return selectorFrame(width, this.rows, this.title, this.purpose, [], body, [], [], {
			maxBodyRows: Math.max(1, this.rows - 7),
		});
	}

	invalidate(): void {
		this.component.invalidate();
	}
}

interface Scenario {
	name: string;
	purpose: string;
	component: Component;
}

const root = resolve(import.meta.dir, "../../..");
const output = resolve(process.argv[2] ?? join(root, "packages/coding-agent/test/evidence/component-boundaries-v1"));
await mkdir(output, { recursive: true });
const auditPath = join(root, "packages/coding-agent/test/evidence/source-boundary-audit-v1/audit.json");
const audit = (await Bun.file(auditPath).json()) as { fingerprint: string; audits: Array<{ sha256: string }> };
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
if (revision.exitCode !== 0) throw new Error("Cannot establish capture revision");
const fingerprint = createHash("sha256")
	.update(audit.fingerprint)
	.update(await Bun.file(import.meta.path).bytes())
	.update(audit.audits.map(entry => entry.sha256).join(""))
	.digest("hex");

function makePrimitiveCatalog(): Component {
	const box = new Box(1, 1);
	box.addChild(new Text(theme.fg("accent", theme.bold("Shared rendering primitives")), 0, 0));
	box.addChild(new Markdown("**Markdown** keeps links, emphasis, and wrapping bounded.", 0, 0, getMarkdownTheme()));
	const input = new Input();
	input.setValue("synthetic editable input");
	box.addChild(input);
	box.addChild(
		new SelectList(
			[
				{ value: "cancel", label: "Cancel", description: "No mutation" },
				{ value: "continue", label: "Continue", description: "Explicit action" },
			],
			2,
			getSelectListTheme(),
		),
	);
	box.addChild(
		new TabBar(
			"Scope",
			[
				{ id: "user", label: "User" },
				{ id: "project", label: "Project" },
			],
			{
				label: value => theme.fg("muted", value),
				activeTab: value => theme.fg("accent", value),
				inactiveTab: value => theme.fg("dim", value),
				hint: value => theme.fg("dim", value),
			},
		),
	);
	box.addChild(new TruncatedText("Long content remains visibly bounded at narrow widths.", 0, 0));
	box.addChild(
		new Image(
			"AA==",
			"image/png",
			{ fallbackColor: value => theme.fg("dim", value) },
			{ filename: "synthetic.png" },
			{ widthPx: 10, heightPx: 10 },
		),
	);
	return box;
}

function makeEditor(): Component {
	const editor = new Editor(getEditorTheme());
	editor.setText("Synthetic editor draft\nSecond line remains editable.");
	editor.setMaxHeight(4);
	return editor;
}

function makeLoader(tui: TUI): Component {
	const loader = new CancellableLoader(
		tui,
		value => theme.fg("accent", value),
		value => theme.fg("muted", value),
		"Synthetic work remains interruptible",
		["*"],
	);
	loader.stop();
	return loader;
}

function makeScenarios(tui: TUI, rows: number): Scenario[] {
	const framed = (name: string, purpose: string, component: Component): Scenario => ({
		name,
		purpose,
		component: new FramedComponent(name, purpose, component, rows),
	});
	const rules: Rule[] = [
		{
			name: "synthetic-rule",
			path: "/synthetic/rule.md",
			content: "Line one\nLine two\nLine three",
			description: "Synthetic rule notification",
			_source: {} as Rule["_source"],
		},
	];
	return [
		framed(
			"primitive-catalog",
			"Shared Box, Text, Markdown, Input, SelectList, TabBar, truncation, and image fallback.",
			makePrimitiveCatalog(),
		),
		framed("editor", "Bounded multiline editor with retained draft.", makeEditor()),
		framed("loader", "Explicit Ctrl+C interruption; Escape is not cancellation.", makeLoader(tui)),
		framed(
			"branch-summary",
			"Read-only persisted branch summary rendering.",
			new BranchSummaryMessageComponent({
				role: "branchSummary",
				summary: "Synthetic branch summary",
				fromId: "synthetic-parent",
				timestamp: 1,
			}),
		),
		framed(
			"compaction-summary",
			"Read-only persisted compaction summary rendering.",
			new CompactionSummaryMessageComponent({
				role: "compactionSummary",
				summary: "Synthetic compacted context",
				shortSummary: "Synthetic short summary",
				tokensBefore: 1234,
				timestamp: 1,
			}),
		),
		framed(
			"custom-message",
			"Public custom renderer fallback; transcript structure is unchanged.",
			new CustomMessageComponent({
				role: "custom",
				customType: "synthetic",
				content: "Synthetic custom message",
				display: true,
				timestamp: 1,
			}),
		),
		framed(
			"hook-message",
			"Legacy hook rendering remains readable without changing its callback contract.",
			new HookMessageComponent({
				role: "hookMessage",
				customType: "synthetic-hook",
				content: "Synthetic hook message",
				display: true,
				timestamp: 1,
			}),
		),
		framed(
			"skill-message",
			"Skill metadata remains distinct from the preserved transcript payload.",
			new SkillMessageComponent({
				role: "custom",
				customType: "skill-prompt",
				content: "Synthetic skill prompt",
				display: true,
				details: { name: "synthetic-skill", path: "/synthetic/SKILL.md", lineCount: 1 },
				timestamp: 1,
			}),
		),
		{
			name: "plan-preview",
			purpose: "Static plan preview; mutation controls live in the reviewed overlay.",
			component: new PlanPreviewComponent("# Synthetic plan\n\n1. Verify the isolated fixture."),
		},
		{
			name: "transcript-notice",
			purpose: "Bounded transcript-adjacent notice.",
			component: new TranscriptNoticeComponent(
				"Synthetic notice",
				"Read-only transcript-adjacent status.",
				"No transcript mutation.",
			),
		},
		framed(
			"ttsr-notification",
			"Read-only interruption notification with expandable detail.",
			new TtsrNotificationComponent(rules),
		),
		{
			name: "queue-selector",
			purpose: "Draft-only queue choice; its caller owns reviewed persistence.",
			component: new QueueModeSelectorComponent(
				"one-at-a-time",
				() => {},
				() => {},
			),
		},
		{
			name: "image-selector",
			purpose: "Draft-only image-display choice.",
			component: new ShowImagesSelectorComponent(
				true,
				() => {},
				() => {},
			),
		},
		{
			name: "theme-selector",
			purpose: "Draft-only theme preview; persistence occurs after review.",
			component: new ThemeSelectorComponent(
				"xcsh-dark",
				["xcsh-dark", "xcsh-light"],
				() => {},
				() => {},
				() => {},
			),
		},
		{
			name: "thinking-selector",
			purpose: "Draft-only reasoning-level choice.",
			component: new ThinkingSelectorComponent(
				ReasoningEffort.Low,
				[ReasoningEffort.Low, ReasoningEffort.High],
				() => {},
				() => {},
			),
		},
		{
			name: "litellm-model-selector",
			purpose: "Provider-qualified default-model draft after validation.",
			component: new LiteLLMModelSelectorComponent(
				LITELLM_LOGIN_MODEL_CHOICES,
				() => {},
				() => {},
			),
		},
		{
			name: "vllm-model-selector",
			purpose: "Discovered local-model draft after validation.",
			component: new VllmModelSelectorComponent(
				[
					{
						label: "synthetic-model",
						description: "Disposable model",
						provider: "vllm",
						modelId: "synthetic-model",
					},
				],
				() => {},
				() => {},
			),
		},
		framed(
			"keybinding-hints",
			"Hints derive from active bindings rather than hard-coded navigation.",
			new Text(
				appKeyHint(KeybindingsManager.inMemory(), "app.interrupt", "interrupt") +
					"\n" +
					rawKeyHint("Enter", "choose"),
				0,
				0,
			),
		),
	];
}

let captures = 0;
let scenarioCount = 0;
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
			const scenarios = makeScenarios(tui, rows);
			scenarioCount = scenarios.length;
			for (const scenario of scenarios) {
				await writeTerminalCapture(
					output,
					`${scenario.name}-${columns}x${rows}-${themeName}-${symbols}`,
					scenario.component.render(columns),
					{ columns, rows },
					themeName === "xcsh-dark"
						? { foreground: "#d8dee9", background: "#1f2430" }
						: { foreground: "#2e3440", background: "#f7f7f5" },
					{
						fixture: "component-boundaries-v1",
						theme: themeName,
						symbols,
						state: scenario.name,
						purpose: scenario.purpose,
						revision: revision.stdout.toString().trim(),
						fingerprint,
						sourceAuditFingerprint: audit.fingerprint,
						persistenceProof:
							"Rendering fixture is read-only or draft-only; caller persistence is independently verified by domain matrices.",
						visualVerdict: "unexamined",
					},
				);
				captures++;
			}
		}

console.log(JSON.stringify({ captures, scenarios: scenarioCount, fingerprint, output }));
