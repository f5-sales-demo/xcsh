import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ChatRequestMsg, MockTransport, type Transport } from "../src/core";
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

test("New chat: disabled until there's a settled turn, then clears the transcript and resets history_hint", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	const newChatBtn = () => scope.getByRole("button", { name: /new chat/i }) as HTMLButtonElement;
	// No turns yet → disabled.
	expect(newChatBtn().disabled).toBe(true);

	// Once there's a turn, New chat is enabled — including while it streams (recovery).
	fireEvent.click(scope.getByRole("button", { name: /summarize/i }));
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	const req1 = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0];
	if (!req1) throw new Error("expected chat_request");
	await act(async () => {
		mock.emit({ type: "chat_done", id: req1.id });
	});
	await waitFor(() => expect(newChatBtn().disabled).toBe(false));

	// Click New chat → transcript clears (the user prompt row is gone).
	fireEvent.click(newChatBtn());
	await waitFor(() => expect(scope.queryByText("Summarize this document.")).toBeNull());

	// The next turn starts a fresh conversation: a NEW history_hint.
	fireEvent.click(scope.getByRole("button", { name: /summarize/i }));
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request");
	expect(reqs[reqs.length - 1].history_hint).not.toBe(req1.history_hint);
});

test("New chat is available WHILE streaming and aborts the in-flight turn (wedge recovery)", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();
	const newChatBtn = () => scope.getByRole("button", { name: /new chat/i }) as HTMLButtonElement;

	fireEvent.click(scope.getByRole("button", { name: /summarize/i }));
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	const req = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0];
	if (!req) throw new Error("expected chat_request");

	// Turn is streaming (no chat_done) — New chat must be usable as a recovery action.
	expect(newChatBtn().disabled).toBe(false);

	fireEvent.click(newChatBtn());
	// It aborts the in-flight turn on the server (chat_stop) and clears the transcript.
	const stops = mock.sent.filter(m => m.type === "chat_stop");
	expect(stops.some(s => (s as { id: string }).id === req.id)).toBe(true);
	await waitFor(() => expect(scope.queryByText("Summarize this document.")).toBeNull());
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

test("the + menu offers 'Add files or photos'", async () => {
	const { container } = render(<ChatPanel transport={new MockTransport()} />);
	const scope = within(container);
	await settle();
	// Open the composer "+" (Add context) menu.
	fireEvent.click(scope.getByRole("button", { name: /add context/i }));
	expect(scope.getByRole("menuitem", { name: /add files or photos/i })).toBeDefined();
});

test("attaching a photo shows a chip, rides chat_request.images (not the text), then clears after send", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	// A picked PNG flows through the hidden file input → FileReader → base64 chip.
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	const file = new File(["\x89PNG\r\n\x1a\n"], "photo.png", { type: "image/png" });
	await act(async () => {
		fireEvent.change(input, { target: { files: [file] } });
		// Let the async FileReader.onload resolve + state settle.
		await new Promise(r => setTimeout(r, 0));
	});

	// Chip is shown for the attachment.
	await waitFor(() => expect(scope.getByText("photo.png")).toBeDefined());

	// Type a prompt and send.
	const editor = scope.getByRole("textbox", { name: /message input/i });
	editor.textContent = "describe this image";
	fireEvent.input(editor);
	fireEvent.click(scope.getByRole("button", { name: /send/i }));

	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected a chat_request");
	// The image rides chat_request.images, NOT the serialized text.
	expect(req.text).toBe("describe this image");
	expect(req.images).toBeDefined();
	expect(req.images?.[0]?.mimeType).toBe("image/png");
	expect(typeof req.images?.[0]?.data).toBe("string");
	expect((req.images?.[0]?.data.length ?? 0) > 0).toBe(true);

	// Chips clear after send (host-maps-its-own-state contract).
	await waitFor(() => expect(scope.queryByText("photo.png")).toBeNull());
});

test("a photo can be sent with no typed text (images-only turn)", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	const file = new File(["data"], "shot.jpg", { type: "image/jpeg" });
	await act(async () => {
		fireEvent.change(input, { target: { files: [file] } });
		await new Promise(r => setTimeout(r, 0));
	});
	await waitFor(() => expect(scope.getByText("shot.jpg")).toBeDefined());

	// Send is enabled despite the empty editor (an attachment is staged).
	const send = scope.getByRole("button", { name: /send/i }) as HTMLButtonElement;
	expect(send.disabled).toBe(false);
	fireEvent.click(send);

	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected a chat_request");
	expect(req.text).toBe("");
	expect(req.images?.[0]?.mimeType).toBe("image/jpeg");
});

test("the + menu gains a Skills submenu once the engine reports skills; picking prefills /name", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	// The pane requested skills on connect; the engine replies with two.
	await act(async () => {
		mock.emit({
			type: "skills",
			skills: [
				{ name: "competitive", description: "F5 XC battlecards" },
				{ name: "roi-calculator", description: "ROI / TCO" },
			],
		} as never);
	});

	// Open the "+" menu → the Skills category is now present.
	fireEvent.click(scope.getByRole("button", { name: /add context/i }));
	fireEvent.click(scope.getByRole("menuitem", { name: /^Skills/ }));
	// The Skills submenu lists the skills; pick one.
	fireEvent.click(scope.getByRole("menuitem", { name: /competitive/i }));

	// The composer is prefilled with the slash-invocation (NOT sent).
	const editor = scope.getByRole("textbox", { name: /message input/i });
	expect(editor.textContent).toBe("/competitive ");
	expect(mock.sent.filter(m => m.type === "chat_request")).toHaveLength(0);
});

test("no Skills category when the engine reports no skills", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();
	// No skills reply (or an empty one) → only the photos category in the + menu.
	fireEvent.click(scope.getByRole("button", { name: /add context/i }));
	expect(scope.queryByRole("menuitem", { name: /^Skills/ })).toBeNull();
	expect(scope.getByRole("menuitem", { name: /add files or photos/i })).toBeDefined();
});

test("Add a folder: picks a path via the bridge, shows a chip, and sends contextPaths (not text)", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	fireEvent.click(scope.getByRole("button", { name: /add context/i }));
	await act(async () => {
		fireEvent.click(scope.getByRole("menuitem", { name: /add a folder/i }));
		await new Promise(r => setTimeout(r, 0)); // handleRequestAttachment sends pick_path
		mock.emit({ type: "path_picked", path: "/Users/me/ctx" } as never); // engine replies
		await new Promise(r => setTimeout(r, 0));
	});

	// A path-only chip shows the folder's basename.
	await waitFor(() => expect(scope.getByText("ctx")).toBeDefined());
	// The pick_path frame carried the folder mode.
	expect(mock.sent.some(m => m.type === "pick_path" && (m as { mode?: string }).mode === "folder")).toBe(true);

	const editor = scope.getByRole("textbox", { name: /message input/i });
	editor.textContent = "summarize this folder";
	fireEvent.input(editor);
	fireEvent.click(scope.getByRole("button", { name: /send/i }));

	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected chat_request");
	// The path rides contextPaths, NOT the message text.
	expect(req.text).toBe("summarize this folder");
	expect(req.contextPaths).toEqual(["/Users/me/ctx"]);
});

test("Search the web: toggling the + menu category OFF drops web_search from the turn", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	// It starts ON (default), so one click turns it OFF.
	fireEvent.click(scope.getByRole("button", { name: /add context/i }));
	fireEvent.click(scope.getByRole("menuitemcheckbox", { name: /search the web/i }));

	// Type + send.
	const editor = scope.getByRole("textbox", { name: /message input/i });
	editor.textContent = "what shipped this week?";
	fireEvent.input(editor);
	fireEvent.click(scope.getByRole("button", { name: /send/i }));

	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected chat_request");
	// Opted out → the field is omitted entirely (clean frame, no server tool injected).
	expect(req.web_search).toBeUndefined();
});

test("web search is ON by default: the + menu shows it checked and turns carry web_search", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();

	// Default-on: the toggle is already checked without the user touching it.
	fireEvent.click(scope.getByRole("button", { name: /add context/i }));
	const item = scope.getByRole("menuitemcheckbox", { name: /search the web/i });
	expect(item.getAttribute("aria-checked")).toBe("true");
	// Close the menu, then send.
	fireEvent.click(item); // toggles OFF
	expect(scope.getByRole("menuitemcheckbox", { name: /search the web/i }).getAttribute("aria-checked")).toBe("false");
	fireEvent.click(scope.getByRole("menuitemcheckbox", { name: /search the web/i })); // back ON

	const editor = scope.getByRole("textbox", { name: /message input/i });
	editor.textContent = "current events?";
	fireEvent.input(editor);
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	const req = mock.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected chat_request");
	expect(req.web_search).toBe(true);
});

test("first-run with no bridge shows an onboarding screen (not a broken error state)", async () => {
	// A transport whose connect() always rejects = no bridge running.
	const noBridge: Transport = {
		state: "idle",
		connect: () => Promise.reject(new Error("ECONNREFUSED")),
		send: () => {},
		onMessage: () => () => {},
		stop: () => {},
		dispose: () => {},
	};
	const { container } = render(<ChatPanel transport={noBridge} />);
	const scope = within(container);
	await settle();

	// The onboarding screen shows install instructions — not the generic "Connection to the assistant was lost."
	expect(scope.getByText(/install xcsh/i)).toBeDefined();
	expect(scope.getByText(/xcsh office serve/i)).toBeDefined();
	expect(scope.getByRole("button", { name: /retry/i })).toBeDefined();
	// The generic error message should NOT appear on first-run.
	expect(scope.queryByText(/connection to the assistant was lost/i)).toBeNull();
});

test("while a web-search turn streams, the Thinking row says why (not a bare hang)", async () => {
	const mock = new MockTransport();
	const { container } = render(<ChatPanel transport={mock} />);
	const scope = within(container);
	await settle();
	fireEvent.click(scope.getByRole("button", { name: /summarize/i }));
	fireEvent.click(scope.getByRole("button", { name: /send/i }));
	// Pre-first-token: the row explains the extra latency.
	await waitFor(() => expect(scope.getByText(/Thinking….*with web search/)).toBeDefined());
});
