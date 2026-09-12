import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { setKeybindings, type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import { HookEditorComponent } from "../src/modes/components/hook-editor";
import { ExtensionUiController } from "../src/modes/controllers/extension-ui-controller";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import { UserInteractions } from "../src/session/user-interactions";

beforeAll(async () => {
	const theme = await getThemeByName("xcsh-dark");
	if (!theme) {
		throw new Error("Failed to load dark theme for tests");
	}
	setThemeInstance(theme);
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
	vi.restoreAllMocks();
});

function createTui(): TUI {
	return {
		requestRender: vi.fn(),
		setFocus: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		terminal: { columns: 120, rows: 24 },
	} as unknown as TUI;
}

function renderText(component: HookEditorComponent, width = 120): string {
	return Bun.stripANSI(component.render(width).join("\n"));
}

function renderLines(component: HookEditorComponent, width = 120): string[] {
	return Bun.stripANSI(component.render(width).join("\n")).split("\n");
}

type TestContext = InteractiveModeContext & {
	editorContainer: {
		children: unknown[];
		clear: () => void;
		addChild: (child: unknown) => void;
	};
};

function createControllerContext() {
	const notifyUserPrompt = vi.fn();
	const editor = { id: "core-editor" };
	const editorContainer = {
		children: [editor] as unknown[],
		clear() {
			this.children = [];
		},
		addChild(child: unknown) {
			this.children.push(child);
		},
	};
	const ui = {
		requestRender: vi.fn(),
		setFocus: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		terminal: { columns: 120, rows: 24 },
		showOverlay(component: unknown) {
			const previous = [...editorContainer.children];
			editorContainer.clear();
			editorContainer.addChild(component);
			let hidden = false;
			return {
				hide() {
					if (hidden) return;
					hidden = true;
					editorContainer.clear();
					for (const child of previous) editorContainer.addChild(child);
				},
			};
		},
	} as unknown as TestContext["ui"] & {
		setFocus: ReturnType<typeof vi.fn>;
		requestRender: ReturnType<typeof vi.fn>;
	};
	const ctx = {
		session: { userInteractions: new UserInteractions(), notifyUserPrompt },
		editor,
		editorContainer,
		ui,
		hookEditor: undefined,
	} as unknown as TestContext;

	return { ctx, editor, editorContainer, notifyUserPrompt, ui };
}

describe("HookEditorComponent default (hook) mode", () => {
	it("bounds long drafts at all supported sizes without losing their submitted text", () => {
		const text = Array.from({ length: 60 }, (_, index) => `Synthetic draft line ${index}`).join("\n");
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			const tui = createTui();
			Object.assign(tui.terminal, { columns, rows });
			const submitted = vi.fn();
			const component = new HookEditorComponent(tui, "Edit synthetic draft", text, submitted, vi.fn());
			const lines = component.render(columns);
			expect(lines.length).toBeLessThanOrEqual(rows);
			expect(lines.every(line => visibleWidth(line) <= Math.min(columns, 100))).toBe(true);
			component.handleInput("\x1b[13;5u");
			component.handleInput("\x1b[13;5u");
			expect(submitted).toHaveBeenCalledTimes(1);
			expect(submitted).toHaveBeenCalledWith(text);
		}
	});
	it("Escape returns from question details before closing and preserves the draft", () => {
		const cancelled = vi.fn();
		const submitted = vi.fn();
		const tui = createTui();
		Object.assign(tui.terminal, { rows: 20 });
		const component = new HookEditorComponent(
			tui,
			"Long synthetic question. ".repeat(40),
			"draft",
			submitted,
			cancelled,
		);
		component.render(60);
		component.handleInput("\t");
		component.handleInput("\x1b[6~");
		component.handleInput("\x1b");
		expect(cancelled).not.toHaveBeenCalled();
		component.handleInput("\x1b[13;5u");
		expect(submitted).toHaveBeenCalledWith("draft");
	});
	it("inserts a newline on Enter instead of submitting immediately", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, onSubmit, onCancel);

		component.handleInput("a");
		component.handleInput("b");
		component.handleInput("\n");

		expect(onSubmit).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();

		component.handleInput("c");
		component.handleInput("d");
		component.handleInput("\x1b[13;5u");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("ab\ncd");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("submits the current text on Ctrl+Enter", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", "line 1\nline 2", onSubmit, onCancel);

		component.handleInput("\x1b[13;5u");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("line 1\nline 2");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("cancels on Escape", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", "draft", onSubmit, onCancel);

		component.handleInput("\x1b");

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("HookEditorComponent prompt-style mode", () => {
	it("submits on plain Enter", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("a");
		component.handleInput("b");
		component.handleInput("\r");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("ab");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("submits on alternate Enter encodings recognized by the key matcher", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("a");
		component.handleInput("\x1bOM");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("a");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("submits when a terminal reports plain Enter as LF", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("a");
		component.handleInput("\n");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("a");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("inserts newline on Shift+Enter instead of submitting", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("a");
		component.handleInput("\x1b[13;2~");

		expect(onSubmit).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();

		component.handleInput("b");
		component.handleInput("\r");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("a\nb");
	});

	it("treats Ctrl+Enter as newline in prompt-style mode", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("x");
		component.handleInput("\x1b[13;5u");

		expect(onSubmit).not.toHaveBeenCalled();

		component.handleInput("y");
		component.handleInput("\r");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("x\ny");
	});

	it("renders prompt-style editor in the shared bounded frame", () => {
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, vi.fn(), vi.fn(), {
			promptStyle: true,
		});

		const rendered = renderText(component);
		const lines = renderLines(component);

		expect(lines[0]).toMatch(/^╭─+╮$/);
		expect(lines.at(-1)).toMatch(/^╰─+╯$/);
		expect(lines.some(line => line.includes("> "))).toBe(true);
		expect(rendered).not.toContain("enter submit");
		expect(rendered).toContain("Shift+Enter: newline");
		expect(rendered).toContain("Ctrl+G: external editor");
		expect(lines.every(line => visibleWidth(line) <= 100)).toBe(true);
	});

	it("keeps the prompt gutter visible after typing in prompt-style mode", () => {
		const component = new HookEditorComponent(createTui(), "Prompt", undefined, vi.fn(), vi.fn(), {
			promptStyle: true,
		});

		for (const char of "hello") {
			component.handleInput(char);
		}

		const lines = renderLines(component);
		expect(lines.some(line => line.includes("> hello"))).toBe(true);
	});

	it("aligns wrapped prompt-style continuation rows under the text column", () => {
		const component = new HookEditorComponent(createTui(), "Prompt", "abcdefghijklm", vi.fn(), vi.fn(), {
			promptStyle: true,
		});

		const lines = renderLines(component, 12);
		expect(lines[4]).toBe("│ > abcdef │");
		expect(lines[5]).toBe("│   ghijkl │");
		expect(lines[6]).toMatch(/^│ {3}m. *│$/);
	});

	it("cancels on Escape", () => {
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", "draft", onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("\x1b");

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("uses remapped navigation, not app.interrupt, to close prompt-style input", () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"app.interrupt": "ctrl+c",
				"tui.select.cancel": "alt+x",
			}),
		);
		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const component = new HookEditorComponent(createTui(), "Prompt", "draft", onSubmit, onCancel, {
			promptStyle: true,
		});

		component.handleInput("\x03");
		component.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();
		component.handleInput("\x1bx");

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("ExtensionUiController hook editor abort", () => {
	it.each(["select", "input", "editor"])("remote answers settle the actual %s widget", async kind => {
		const { ctx, editor, editorContainer } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const result =
			kind === "select"
				? controller.showHookSelector("Fixture", ["Yes", "No"])
				: kind === "input"
					? controller.showHookInput("Fixture")
					: controller.showHookEditor("Fixture");
		await Bun.sleep(0);
		const pending = ctx.session.userInteractions.pending()[0];
		expect(pending).toBeDefined();
		expect(ctx.session.userInteractions.respond(pending.id, "Yes")).toBe(true);
		expect(await result).toBe("Yes");
		expect(editorContainer.children).toEqual([editor]);
		expect(ctx.session.userInteractions.pending()).toEqual([]);
	});

	it.each(["select", "input", "editor"])("late %s input cannot dismiss the next prompt", async kind => {
		const { ctx, editorContainer } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const open = () =>
			kind === "select"
				? controller.showHookSelector("Fixture", ["Yes", "No"])
				: kind === "input"
					? controller.showHookInput("Fixture")
					: controller.showHookEditor("Fixture");
		const first = open();
		const oldWidget = (kind === "select" ? ctx.hookSelector : kind === "input" ? ctx.hookInput : ctx.hookEditor)!;
		ctx.session.userInteractions.respond(ctx.session.userInteractions.pending()[0].id, "Yes");
		await first;
		const second = open();
		const nextWidget = editorContainer.children[0];
		oldWidget.handleInput("\x1b");
		expect(editorContainer.children).toEqual([nextWidget]);
		expect(ctx.session.userInteractions.pending()).toHaveLength(1);
		ctx.session.userInteractions.cancelAll();
		expect(await second).toBeUndefined();
	});

	it.each(["select", "input", "editor"])(
		"terminal %s cancellation wins against an immediate remote answer",
		async kind => {
			const { ctx } = createControllerContext();
			const controller = new ExtensionUiController(ctx);
			const result =
				kind === "select"
					? controller.showHookSelector("Fixture", ["Yes", "No"])
					: kind === "input"
						? controller.showHookInput("Fixture")
						: controller.showHookEditor("Fixture");
			const widget = (kind === "select" ? ctx.hookSelector : kind === "input" ? ctx.hookInput : ctx.hookEditor)!;
			const id = ctx.session.userInteractions.pending()[0].id;
			widget.handleInput("\x1b");
			expect(ctx.session.userInteractions.respond(id, "Yes")).toBe(false);
			expect(await result).toBeUndefined();
		},
	);

	it("concurrent prompts queue terminal presentation while remaining answerable remotely", async () => {
		const { ctx, editorContainer, editor } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const first = controller.showHookSelector("First", ["Yes", "No"]);
		const firstWidget = ctx.hookSelector;
		const second = controller.showHookInput("Second");
		const third = controller.showHookEditor("Third");
		const [a, b, c] = ctx.session.userInteractions.pending();
		expect(editorContainer.children).toEqual([firstWidget]);
		expect(ctx.session.userInteractions.respond(b.id, "remote queued answer")).toBe(true);
		expect(await second).toBe("remote queued answer");
		expect(editorContainer.children).toEqual([firstWidget]);
		ctx.session.userInteractions.respond(a.id, "No");
		expect(await first).toBe("No");
		expect(editorContainer.children).toEqual([ctx.hookEditor]);
		expect(ctx.hookEditor).toBeDefined();
		ctx.session.userInteractions.respond(c.id, "last answer");
		expect(await third).toBe("last answer");
		expect(editorContainer.children).toEqual([editor]);
	});

	it("a grouped remote answer dismisses the terminal form without exposing intermediate dialogs", async () => {
		const { ctx, editorContainer, editor } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const questions = [
			{ id: "colors", question: "Colors?", options: [{ label: "Blue" }, { label: "Green" }], multi: true },
			{ id: "note", question: "Note?", options: [] },
		];
		const result = controller.showHookQuestions(questions);
		const pending = ctx.session.userInteractions.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ kind: "questions", questions });
		const oldWidget = ctx.hookSelector!;
		const answer = {
			colors: { selectedOptions: ["Blue", "Green"] },
			note: { selectedOptions: [], customInput: "Keep both" },
		};
		expect(ctx.session.userInteractions.respond(pending[0].id, answer)).toBe(true);
		expect(await result).toEqual(answer);
		const next = controller.showHookInput("Next");
		const nextWidget = ctx.hookInput;
		oldWidget.handleInput("\x1b");
		expect(editorContainer.children).toEqual([nextWidget]);
		ctx.session.userInteractions.cancelAll();
		await next;
		expect(editorContainer.children).toEqual([editor]);
	});

	it("the terminal completes grouped choices and free text through one request identity", async () => {
		const { ctx, editorContainer, editor } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const result = controller.showHookQuestions([
			{ id: "color", question: "Color?", options: [{ label: "Blue" }] },
			{ id: "note", question: "Note?", options: [] },
		]);
		const id = ctx.session.userInteractions.pending()[0].id;
		ctx.hookSelector!.handleInput("\r");
		await Bun.sleep(0);
		expect(ctx.session.userInteractions.pending().map(value => value.id)).toEqual([id]);
		ctx.hookSelector!.handleInput("\r");
		await Bun.sleep(0);
		ctx.hookEditor!.handleInput("Local note");
		ctx.hookEditor!.handleInput("\r");
		expect(await result).toEqual({
			color: { selectedOptions: ["Blue"] },
			note: { selectedOptions: [], customInput: "Local note" },
		});
		expect(ctx.session.userInteractions.pending()).toEqual([]);
		expect(editorContainer.children).toEqual([editor]);
	});

	it("confirmation cancellation reaches the selector and never becomes consent", async () => {
		const { ctx, editor, editorContainer } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const abort = new AbortController();
		const result = controller.showHookConfirm("Fixture", "Continue?", { signal: abort.signal });
		abort.abort();
		expect(await Promise.race([result, Bun.sleep(20).then(() => "pending")])).toBe(false);
		expect(editorContainer.children).toEqual([editor]);
		expect(ctx.session.userInteractions.pending()).toEqual([]);
	});

	it("hides the hook editor and resolves undefined when the caller aborts", async () => {
		const { ctx, editor, editorContainer, notifyUserPrompt, ui } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const abortController = new AbortController();
		const controllerWithAbort = controller as unknown as {
			showHookEditor: (
				title: string,
				prefill?: string,
				dialogOptions?: { signal?: AbortSignal },
				editorOptions?: { promptStyle?: boolean },
			) => Promise<string | undefined>;
		};

		const promise = controllerWithAbort.showHookEditor("Prompt", "draft", { signal: abortController.signal });

		expect(editorContainer.children).toHaveLength(1);
		expect(ctx.hookEditor).toBeDefined();

		abortController.abort();
		await Bun.sleep(0);

		expect(editorContainer.children).toEqual([editor]);
		expect(ctx.hookEditor).toBeUndefined();
		expect(ui.setFocus).toHaveBeenLastCalledWith(editor);

		const pending = Symbol("pending");
		const result = await Promise.race([promise, Bun.sleep(20).then(() => pending)]);
		expect(result).toBeUndefined();
		expect(notifyUserPrompt.mock.calls).toEqual([
			["start", "input"],
			["end", "input"],
		]);
	});

	it("forwards editorOptions to HookEditorComponent", async () => {
		const { ctx, editorContainer } = createControllerContext();
		const controller = new ExtensionUiController(ctx);
		const controllerWithOptions = controller as unknown as {
			showHookEditor: (
				title: string,
				prefill?: string,
				dialogOptions?: { signal?: AbortSignal },
				editorOptions?: { promptStyle?: boolean },
			) => Promise<string | undefined>;
		};

		// Start the editor with promptStyle
		const promise = controllerWithOptions.showHookEditor("Ask prompt", undefined, undefined, {
			promptStyle: true,
		});

		expect(editorContainer.children).toHaveLength(1);
		expect(ctx.hookEditor).toBeDefined();

		// The component should be a HookEditorComponent in prompt-style mode.
		// Verify by sending Enter — it should submit, not insert newline.
		const hookEditor = ctx.hookEditor!;
		hookEditor.handleInput("test-text".split("").join(""));
		hookEditor.handleInput("\r");

		// The promise should resolve since Enter submits in prompt-style mode.
		const result = await promise;
		// Result depends on what the editor captured. The key thing is it resolved.
		expect(result).toBeDefined();
	});
});
