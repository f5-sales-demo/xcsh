import { describe, expect, it, vi } from "bun:test";
import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext } from "../src/modes/types";

function createContext(opts: { hasProvider: boolean }) {
	let editorText = "";
	const showWarning = vi.fn();
	const prompt = vi.fn();
	const onInputCallback = vi.fn();
	const handleBashCommand = vi.fn(async () => {});
	const hasActiveLlmProvider = vi.fn(() => opts.hasProvider);
	const editor: {
		onSubmit?: (text: string) => Promise<void>;
		setText(text: string): void;
		getText(): string;
		addToHistory: ReturnType<typeof vi.fn>;
	} = {
		setText(text: string) {
			editorText = text;
		},
		getText() {
			return editorText;
		},
		addToHistory: vi.fn(),
	};
	const ctx = {
		editor,
		ui: { requestRender: vi.fn() },
		session: {
			isStreaming: false,
			isCompacting: false,
			isBashRunning: false,
			isPythonRunning: false,
			queuedMessageCount: 0,
			messages: [],
			extensionRunner: undefined,
			prompt,
		},
		sessionManager: { getSessionName: () => "existing session" },
		pendingImages: [],
		isBashMode: false,
		isPythonMode: false,
		onInputCallback,
		hasActiveLlmProvider,
		showWarning,
		handleBashCommand,
		flushPendingBashComponents: vi.fn(),
		startPendingSubmission: vi.fn((input: { text: string }) => ({
			text: input.text,
			images: undefined,
			cancelled: false,
			started: false,
		})),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
	} as unknown as InteractiveModeContext;
	return { ctx, editor, spies: { showWarning, prompt, onInputCallback, handleBashCommand, hasActiveLlmProvider } };
}

describe("InputController LLM readiness gate", () => {
	it("blocks natural-language input and warns when no provider is configured", async () => {
		const { ctx, editor, spies } = createContext({ hasProvider: false });
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		editor.setText("hello there");
		await editor.onSubmit?.("hello there");

		expect(spies.showWarning).toHaveBeenCalledTimes(1);
		expect(spies.onInputCallback).not.toHaveBeenCalled();
		expect(spies.prompt).not.toHaveBeenCalled();
		// Input is preserved so the user doesn't lose their message.
		expect(editor.getText()).toBe("hello there");
	});

	it("allows natural-language input when a provider is configured", async () => {
		const { ctx, editor, spies } = createContext({ hasProvider: true });
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		editor.setText("hello there");
		await editor.onSubmit?.("hello there");

		expect(spies.showWarning).not.toHaveBeenCalled();
		expect(spies.onInputCallback).toHaveBeenCalledTimes(1);
	});

	it("does not gate bash commands even when no provider is configured", async () => {
		const { ctx, editor, spies } = createContext({ hasProvider: false });
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		editor.setText("!echo hi");
		await editor.onSubmit?.("!echo hi");

		expect(spies.handleBashCommand).toHaveBeenCalledWith("echo hi", false);
		expect(spies.showWarning).not.toHaveBeenCalled();
	});

	it("blocks a follow-up submission when no provider is configured", async () => {
		const { ctx, editor, spies } = createContext({ hasProvider: false });
		const controller = new InputController(ctx);

		editor.setText("follow up text");
		await controller.handleFollowUp();

		expect(spies.showWarning).toHaveBeenCalledTimes(1);
		expect(spies.prompt).not.toHaveBeenCalled();
	});
});
