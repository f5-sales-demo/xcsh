import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "../src/components/Composer";
import type { InteractionMode, ModelOption } from "../src/types";

const MODES: InteractionMode[] = [
	{ id: "educational", label: "Educational", blurb: "explain" },
	{ id: "configuration", label: "Config building", blurb: "build" },
];
const MODELS: ModelOption[] = [
	{ id: "claude-opus-4-8", label: "claude-opus-4-8" },
	{ id: "claude-sonnet-5", label: "claude-sonnet-5" },
];

function type(el: HTMLElement, value: string): void {
	el.textContent = value;
	fireEvent.input(el);
}

test("send is disabled while the editor is empty and enables after typing", () => {
	render(<Composer streaming={false} onSend={() => {}} onStop={() => {}} />);
	const send = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
	expect(send.disabled).toBe(true);
	type(screen.getByRole("textbox"), "hello");
	expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(false);
});

test("submitting sends the trimmed text and clears the editor", () => {
	let sent = "";
	render(<Composer streaming={false} onSend={t => (sent = t)} onStop={() => {}} />);
	const editor = screen.getByRole("textbox");
	type(editor, "  ship it  ");
	fireEvent.click(screen.getByRole("button", { name: /send/i }));
	expect(sent).toBe("ship it");
	expect(editor.textContent).toBe("");
});

test("Enter (without shift) submits", () => {
	let sent = "";
	render(<Composer streaming={false} onSend={t => (sent = t)} onStop={() => {}} />);
	const editor = screen.getByRole("textbox");
	type(editor, "go");
	fireEvent.keyDown(editor, { key: "Enter" });
	expect(sent).toBe("go");
});

test("while streaming, the send button is replaced by a stop button that fires onStop", () => {
	let stopped = false;
	render(<Composer streaming={true} onSend={() => {}} onStop={() => (stopped = true)} />);
	expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /stop/i }));
	expect(stopped).toBe(true);
});

test("renders the attach button only when onAttach is provided", () => {
	const { rerender } = render(<Composer streaming={false} onSend={() => {}} onStop={() => {}} />);
	expect(screen.queryByRole("button", { name: /attach/i })).toBeNull();
	rerender(<Composer streaming={false} onSend={() => {}} onStop={() => {}} onAttach={() => {}} />);
	expect(screen.getByRole("button", { name: /attach/i })).toBeDefined();
});

test("wires the mode toggle and model selector when their props are provided", () => {
	let mode = "educational";
	let model = "claude-opus-4-8";
	render(
		<Composer
			streaming={false}
			onSend={() => {}}
			onStop={() => {}}
			modes={MODES}
			mode={mode}
			onModeChange={m => (mode = m)}
			models={MODELS}
			model={model}
			onModelChange={m => (model = m)}
		/>,
	);
	// Mode toggle shows the current mode; open + pick another.
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /Educational/ }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /Config building/ }));
	expect(mode).toBe("configuration");

	// Model selector shows the current model; open + pick another.
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /model: claude-opus-4-8/i }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /claude-sonnet-5/ }));
	expect(model).toBe("claude-sonnet-5");
});
