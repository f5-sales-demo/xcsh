import { expect, test } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MockTransport } from "../src/core";
import { ChatPanel } from "../src/panel";

test("renders the terminal shell: header, transcript live region, and composer", () => {
	const { container } = render(<ChatPanel transport={new MockTransport()} />);
	const scope = within(container);
	expect(scope.getByRole("log", { name: /conversation/i })).toBeDefined();
	expect(scope.getByRole("textbox", { name: /message input/i })).toBeDefined();
	// F5-branded header title.
	expect(scope.getByText("xcsh")).toBeDefined();
});

test("the empty state offers starter pills that PREFILL the composer without sending", () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);

	const pill = scope.getByRole("button", { name: /summarize/i });
	fireEvent.click(pill);

	const editor = scope.getByRole("textbox", { name: /message input/i });
	expect(editor.textContent).toBe("Summarize this document.");
	// Populated for editing — NOT sent: no chat_request reached the transport, and
	// Send is enabled for the user to submit when they choose to.
	expect(mock.sent.filter(m => m.type === "chat_request")).toHaveLength(0);
	expect((scope.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(false);
});
