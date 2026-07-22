import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ChatRequestMsg, MockTransport } from "../src/core";
import { ChatPanel } from "../src/panel";

/** Flush the connect→provision→ready microtask chain. */
async function settle(): Promise<void> {
	await act(async () => {
		await new Promise(r => setTimeout(r, 0));
	});
}

test("renders the terminal shell: header, transcript live region, and composer", () => {
	const { container } = render(<ChatPanel transport={new MockTransport()} />);
	const scope = within(container);
	expect(scope.getByRole("log", { name: /conversation/i })).toBeDefined();
	expect(scope.getByRole("textbox", { name: /message input/i })).toBeDefined();
	// F5-branded header title.
	expect(scope.getByText("xcsh")).toBeDefined();
});

test("the empty state offers starter pills that PREFILL the composer without sending", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	// Once provisioned (no provision hook → ready after connect), the composer is enabled.
	await settle();

	const pill = scope.getByRole("button", { name: /summarize/i });
	fireEvent.click(pill);

	const editor = scope.getByRole("textbox", { name: /message input/i });
	expect(editor.textContent).toBe("Summarize this document.");
	// Populated for editing — NOT sent: no chat_request reached the transport, and
	// Send is enabled for the user to submit when they choose to.
	expect(mock.sent.filter(m => m.type === "chat_request")).toHaveLength(0);
	expect((scope.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(false);
	// No duplicate F5 logo in the empty state — the persistent Header carries the brand.
	expect(container.querySelector(".empty-logo")).toBeNull();
});

test("no Chrome-automation mode toggle; chats send the fixed 'educational' mode", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	// The interaction-mode toggle (Chrome browser-automation only) is gone.
	expect(container.querySelector(".mode-btn")).toBeNull();

	// Sending a message uses the fixed Office mode, not `configuration`.
	fireEvent.click(scope.getByRole("button", { name: /summarize/i }));
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected a chat_request to have been sent");
	expect(req.mode).toBe("educational");
});

test("the composer cannot send a turn before provisioning resolves (configure_ack gate)", async () => {
	const mock = new MockTransport();
	// A provision that never resolves keeps the pane in 'configuring'.
	const provision = () => new Promise<void>(() => {});
	const { container } = render(<ChatPanel transport={mock} provision={provision} />);
	const scope = within(container);
	await settle();

	// Editor is non-editable and the Send button is disabled while configuring.
	const editor = scope.getByRole("textbox", { name: /message input/i });
	expect(editor.getAttribute("contenteditable")).toBe("false");
	expect((scope.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
	// Even an Enter keypress can't push a turn through the gate.
	fireEvent.keyDown(editor, { key: "Enter" });
	expect(mock.sent.filter(m => m.type === "chat_request")).toHaveLength(0);
});

test("a rejected provision renders a NON-SILENT config error with a Reconfigure recovery action", async () => {
	const mock = new MockTransport();
	let reconfigured = 0;
	const provision = () => Promise.reject(new Error("configure_error: token expired"));
	const { container } = render(
		<ChatPanel transport={mock} provision={provision} onReconfigure={() => (reconfigured += 1)} />,
	);
	const scope = within(container);

	// The failure is surfaced as an alert carrying the reason — not swallowed to console.
	const alert = await waitFor(() => scope.getByRole("alert"));
	expect(alert.textContent).toMatch(/token expired/i);

	// The recovery action reopens the gateway config.
	const reconfigure = scope.getByRole("button", { name: /reconfigure/i });
	fireEvent.click(reconfigure);
	expect(reconfigured).toBe(1);

	// Chat is NOT presented while unconfigured.
	expect(scope.queryByRole("textbox", { name: /message input/i })).toBeNull();
});

test("auto-opens the gateway config when a turn fails with provider-4xx (bad gateway token)", async () => {
	const mock = new MockTransport();
	let opened = 0;
	const { container } = render(<ChatPanel transport={mock} onProviderConfigError={() => (opened += 1)} />);
	const scope = within(container);
	await settle();

	// Prefill via a starter pill, then send.
	fireEvent.click(scope.getByRole("button", { name: /summarize/i }));
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected a chat_request to have been sent");

	// The worker rejects the turn because the configured provider said 4xx.
	await act(async () => {
		mock.emit({ type: "chat_error", id: req.id, reason: "provider-4xx", error: "401 Unauthorized" });
	});

	expect(opened).toBe(1);
});
