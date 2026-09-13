import { beforeAll, describe, expect, it, vi } from "bun:test";
import { ReasoningEffort } from "@f5-sales-demo/pi-ai";
import {
	Box,
	CancellableLoader,
	Editor,
	Image,
	Input,
	Loader,
	Markdown,
	SelectList,
	Spacer,
	TabBar,
	Text,
	TruncatedText,
	visibleWidth,
} from "@f5-sales-demo/pi-tui";
import { BracketedPasteHandler } from "../../tui/src/bracketed-paste";
import { KillRing } from "../../tui/src/kill-ring";
import { setTerminalImageProtocol, TERMINAL } from "../../tui/src/terminal-capabilities";
import { getTerminalId, getTtyPath } from "../../tui/src/ttyid";
import type { Rule } from "../src/capability/rule";
import { selectSession } from "../src/cli/session-picker";
import { KeybindingsManager } from "../src/config/keybindings";
import { BranchSummaryMessageComponent } from "../src/modes/components/branch-summary-message";
import { CompactionSummaryMessageComponent } from "../src/modes/components/compaction-summary-message";
import { CustomMessageComponent } from "../src/modes/components/custom-message";
import { DynamicBorder } from "../src/modes/components/dynamic-border";
import { HookMessageComponent } from "../src/modes/components/hook-message";
import { appKeyHint, rawKeyHint } from "../src/modes/components/keybinding-hints";
import { LiteLLMModelSelectorComponent } from "../src/modes/components/litellm-model-selector";
import { createLoginPromptInput } from "../src/modes/components/login-prompt-input";
import { PlanPreviewComponent } from "../src/modes/components/plan-preview";
import { QueueModeSelectorComponent } from "../src/modes/components/queue-mode-selector";
import { ShowImagesSelectorComponent } from "../src/modes/components/show-images-selector";
import { SkillMessageComponent } from "../src/modes/components/skill-message";
import { ThemeSelectorComponent } from "../src/modes/components/theme-selector";
import { ThinkingSelectorComponent } from "../src/modes/components/thinking-selector";
import { TranscriptNoticeComponent } from "../src/modes/components/transcript-notice";
import { TtsrNotificationComponent } from "../src/modes/components/ttsr-notification";
import { VllmModelSelectorComponent } from "../src/modes/components/vllm-model-selector";
import { LITELLM_LOGIN_MODEL_CHOICES } from "../src/modes/controllers/login-model";
import { getProviderDisplayName, providerPresentation } from "../src/modes/controllers/provider-presentation";
import { getEditorTheme, getMarkdownTheme, getSelectListTheme, initTheme, theme } from "../src/modes/theme/theme";
import { actionRenderer } from "../src/tools/action-renderer";
import { runInteractiveBashPty } from "../src/tools/bash-interactive";

beforeAll(() => {
	initTheme();
});

function expectBounded(component: { render(width: number): string[] }, width: number, text: string): void {
	const lines = component.render(width);
	expect(lines.length).toBeGreaterThan(0);
	expect(Bun.stripANSI(lines.join("\n"))).toContain(text);
	expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
}

describe("remaining first-party component boundaries", () => {
	it("renders read-only transcript components at narrow and wide widths", () => {
		const components: Array<[{ render(width: number): string[] }, string]> = [
			[
				new BranchSummaryMessageComponent({
					role: "branchSummary",
					summary: "Synthetic branch summary",
					fromId: "synthetic-parent",
					timestamp: 1,
				}),
				"Branch summary",
			],
			[
				new CompactionSummaryMessageComponent({
					role: "compactionSummary",
					summary: "Synthetic compacted context",
					shortSummary: "Synthetic short summary",
					tokensBefore: 1234,
					timestamp: 1,
				}),
				"Compacted from",
			],
			[
				new CustomMessageComponent({
					role: "custom",
					customType: "synthetic",
					content: "Synthetic custom message",
					display: true,
					timestamp: 1,
				}),
				"Synthetic custom message",
			],
			[
				new HookMessageComponent({
					role: "hookMessage",
					customType: "synthetic-hook",
					content: "Synthetic hook message",
					display: true,
					timestamp: 1,
				}),
				"Synthetic hook message",
			],
			[
				new SkillMessageComponent({
					role: "custom",
					customType: "skill-prompt",
					content: "Synthetic skill prompt",
					display: true,
					details: { name: "synthetic-skill", path: "/synthetic/SKILL.md", lineCount: 1 },
					timestamp: 1,
				}),
				"synthetic-skill",
			],
			[new PlanPreviewComponent("# Synthetic plan\n\n1. Verify the isolated fixture."), "Synthetic plan"],
			[
				new TranscriptNoticeComponent(
					"Synthetic notice",
					"Read-only transcript-adjacent status.",
					"No transcript mutation.",
				),
				"No transcript mutation",
			],
			[
				new TtsrNotificationComponent([
					{
						name: "synthetic-rule",
						path: "/synthetic/rule.md",
						content: "Line one\nLine two\nLine three",
						description: "Synthetic rule description",
						_source: {} as Rule["_source"],
					},
				]),
				"synthetic-rule",
			],
		];
		for (const [component, text] of components)
			for (const width of [60, 80, 100, 140]) expectBounded(component, width, text);
	});

	it("keeps selector wrappers draft-only and routes selection or cancellation once", () => {
		const selected = vi.fn();
		const cancelled = vi.fn();
		const selectors = [
			new LiteLLMModelSelectorComponent(LITELLM_LOGIN_MODEL_CHOICES, selected, cancelled),
			new VllmModelSelectorComponent(
				[
					{
						label: "synthetic-model",
						description: "Disposable model",
						provider: "vllm",
						modelId: "synthetic-model",
					},
				],
				selected,
				cancelled,
			),
			new QueueModeSelectorComponent("one-at-a-time", selected, cancelled),
			new ShowImagesSelectorComponent(true, selected, cancelled),
			new ThinkingSelectorComponent(
				ReasoningEffort.Low,
				[ReasoningEffort.Low, ReasoningEffort.High],
				selected,
				cancelled,
			),
		];
		for (const selector of selectors) {
			expectBounded(selector, 60, "Choose");
			selector.getSelectList().handleInput("\r");
		}
		expect(selected).toHaveBeenCalledTimes(selectors.length);

		const preview = vi.fn();
		const themeSelector = new ThemeSelectorComponent(
			"xcsh-dark",
			["xcsh-dark", "xcsh-light"],
			selected,
			cancelled,
			preview,
		);
		expectBounded(themeSelector, 60, "Choose theme");
		themeSelector.getSelectList().handleInput("\x1b[B");
		expect(preview).toHaveBeenCalledWith("xcsh-light");
		themeSelector.getSelectList().handleInput("\x1b");
		expect(cancelled).toHaveBeenCalledTimes(1);
	});

	it("keeps shared primitives bounded and respects explicit interruption", () => {
		const tui = { requestRender: vi.fn() } as never;
		const loader = new Loader(
			tui,
			value => value,
			value => value,
			"Synthetic progress",
			["*"],
		);
		const cancellable = new CancellableLoader(
			tui,
			value => value,
			value => value,
			"Synthetic cancellable",
			["*"],
		);
		loader.stop();
		cancellable.stop();
		const aborted = vi.fn();
		cancellable.onAbort = aborted;
		cancellable.handleInput("\x03");
		expect(cancellable.aborted).toBe(true);
		expect(aborted).toHaveBeenCalledTimes(1);

		const input = new Input();
		input.setValue("synthetic input");
		const editor = new Editor(getEditorTheme());
		editor.setText("synthetic editor");
		editor.setMaxHeight(3);
		const select = new SelectList(
			[
				{ value: "cancel", label: "Cancel", description: "No mutation" },
				{ value: "continue", label: "Continue", description: "Explicit action" },
			],
			2,
			getSelectListTheme(),
		);
		const tabs = new TabBar(
			"Scope",
			[
				{ id: "user", label: "User" },
				{ id: "project", label: "Project" },
			],
			{
				label: value => value,
				activeTab: value => value,
				inactiveTab: value => value,
				hint: value => value,
			},
		);
		const box = new Box(1, 1);
		box.addChild(new Text("Synthetic text", 0, 0));
		box.addChild(new Spacer(1));
		box.addChild(new Markdown("**Synthetic markdown**", 0, 0, getMarkdownTheme()));
		const primitives: Array<[{ render(width: number): string[] }, string]> = [
			[box, "Synthetic"],
			[input, "synthetic input"],
			[editor, "synthetic editor"],
			[select, "Cancel"],
			[tabs, "Scope"],
			[new TruncatedText("Synthetic truncated text", 0, 0), "Synthetic"],
			[new DynamicBorder(value => value), theme.boxSharp.horizontal],
			[
				new Image(
					"AA==",
					"image/png",
					{ fallbackColor: value => value },
					{ filename: "synthetic.png" },
					{ widthPx: 10, heightPx: 10 },
				),
				"synthetic.png",
			],
			[loader, "Synthetic progress"],
			[cancellable, "Synthetic cancellable"],
		];
		const originalImageProtocol = TERMINAL.imageProtocol;
		setTerminalImageProtocol(null);
		try {
			for (const [component, text] of primitives) expectBounded(component, 60, text);
		} finally {
			setTerminalImageProtocol(originalImageProtocol);
		}
	});

	it("keeps prompts masked and keybinding hints sourced from active bindings", () => {
		const prompt = createLoginPromptInput({ secret: true });
		prompt.setValue("synthetic-secret");
		const rendered = Bun.stripANSI(prompt.render(60).join("\n"));
		expect(rendered).not.toContain("synthetic-secret");
		expect(appKeyHint(KeybindingsManager.inMemory(), "app.interrupt", "interrupt")).toContain("ctrl+c");
		expect(Bun.stripANSI(rawKeyHint("Enter", "choose"))).toContain("Enter choose");
	});

	it("preserves non-visual terminal and protocol helper contracts", () => {
		const paste = new BracketedPasteHandler();
		expect(paste.process("\x1b[200~synthetic")).toEqual({ handled: true, remaining: "" });
		expect(paste.process(" paste\x1b[201~tail")).toEqual({
			handled: true,
			pasteContent: "synthetic paste",
			remaining: "tail",
		});

		const ring = new KillRing();
		ring.push("one", { prepend: false });
		ring.push("two", { prepend: false });
		expect(ring.peek()).toBe("two");
		ring.rotate();
		expect(ring.peek()).toBe("one");

		expect(getProviderDisplayName("openai-codex")).toBe("ChatGPT");
		expect(providerPresentation("openai-codex").category).toBe("Subscriptions");
		expect(typeof selectSession).toBe("function");
		expect(typeof actionRenderer.renderCall).toBe("function");
		expect(typeof runInteractiveBashPty).toBe("function");
		expect(typeof getTtyPath).toBe("function");
		expect(getTerminalId() === null || typeof getTerminalId() === "string").toBe(true);
	});
});
