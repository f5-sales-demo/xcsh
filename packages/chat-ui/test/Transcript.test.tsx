import { expect, test } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Transcript } from "../src/components/Transcript";
import type { ChatMessage } from "../src/types";

function msg(over: Partial<ChatMessage> & { id: string; role: ChatMessage["role"] }): ChatMessage {
	return { text: "", ...over };
}

test("renders user, assistant, and tool rows in the terminal gutter grid", () => {
	const messages: ChatMessage[] = [
		msg({ id: "1", role: "user", text: "hello there" }),
		msg({ id: "2", role: "assistant", text: "hi **friend**" }),
		msg({ id: "3", role: "tool", tool: "read_range", ok: true, text: "done" }),
	];
	render(<Transcript messages={messages} streaming={false} />);
	expect(screen.getByText("hello there")).toBeDefined();
	expect(screen.getByText(/hi/)).toBeDefined();
	// Tool rows show the humanized activity label (not the raw function name).
	expect(screen.getByText("Reading cells")).toBeDefined();
});

test("a tool row humanizes the tool name and hides raw detail behind a disclosure", () => {
	render(
		<Transcript
			messages={[msg({ id: "1", role: "tool", tool: "get_workbook_info", ok: true, text: '{"sheets":3}' })]}
			streaming={false}
		/>,
	);
	// Friendly label is visible…
	expect(screen.getByText("Reading workbook structure")).toBeDefined();
	// …and the raw payload lives in a collapsed <details> (present but not expanded).
	const details = document.querySelector("details.tool-activity") as HTMLDetailsElement;
	expect(details).not.toBeNull();
	expect(details.open).toBe(false);
	expect(details.textContent).toContain('{"sheets":3}');
});

test("a running tool row shows the label with a live spinner and no error glyph", () => {
	render(
		<Transcript
			messages={[msg({ id: "1", role: "tool", tool: "read_table", ok: true, text: "", running: true })]}
			streaming={true}
		/>,
	);
	expect(screen.getByText("Reading table")).toBeDefined();
	// A running row uses the spinner gutter class, not the ok/err glyphs.
	expect(document.querySelector(".g-tool-run")).not.toBeNull();
	expect(document.querySelector(".g-tool-err")).toBeNull();
});

test("a detail-less tool row renders a plain activity line (no disclosure)", () => {
	render(
		<Transcript
			messages={[msg({ id: "1", role: "tool", tool: "read_slides", ok: true, text: "" })]}
			streaming={false}
		/>,
	);
	expect(screen.getByText("Reading slides")).toBeDefined();
	expect(document.querySelector("details.tool-activity")).toBeNull();
});

test("a failed tool row shows the error glyph", () => {
	render(
		<Transcript
			messages={[msg({ id: "1", role: "tool", tool: "write_range", ok: false, text: "denied" })]}
			streaming={false}
		/>,
	);
	expect(screen.getByText("Writing cells")).toBeDefined();
	expect(document.querySelector(".g-tool-err")).not.toBeNull();
});

test("the transcript is a labelled polite live region (a11y carried from the Fluent hosts)", () => {
	render(<Transcript messages={[msg({ id: "1", role: "assistant", text: "hi" })]} streaming={false} />);
	const region = screen.getByRole("log", { name: /conversation/i });
	expect(region.getAttribute("aria-live")).toBe("polite");
});

test("the live-region label is overridable", () => {
	render(<Transcript messages={[]} streaming={false} label="Excel chat" />);
	expect(screen.getByRole("log", { name: /excel chat/i })).toBeDefined();
});

test("a streaming assistant row with no text yet shows the thinking indicator", () => {
	render(<Transcript messages={[msg({ id: "1", role: "assistant", text: "" })]} streaming={true} />);
	expect(screen.getByText(/Thinking/)).toBeDefined();
});

test("the LAST assistant row shows a blinking caret WHILE streaming (with partial text)", () => {
	render(<Transcript messages={[msg({ id: "1", role: "assistant", text: "partial" })]} streaming={true} />);
	expect(document.querySelector(".stream-caret")).not.toBeNull();
});

test("a settled assistant row shows NO caret", () => {
	render(<Transcript messages={[msg({ id: "1", role: "assistant", text: "done" })]} streaming={false} />);
	expect(document.querySelector(".stream-caret")).toBeNull();
});

test("only the LAST assistant row carries the streaming caret", () => {
	const messages: ChatMessage[] = [
		msg({ id: "1", role: "assistant", text: "earlier" }),
		msg({ id: "2", role: "user", text: "next" }),
		msg({ id: "3", role: "assistant", text: "streaming now" }),
	];
	render(<Transcript messages={messages} streaming={true} />);
	// Exactly one caret, and it's on the last assistant row (#3).
	expect(document.querySelectorAll(".stream-caret")).toHaveLength(1);
	expect(screen.getByText(/streaming now/)).toBeDefined();
});

test("an error row on the LAST message offers Retry, firing onRetry with retryText", () => {
	let retried = "";
	const messages: ChatMessage[] = [
		msg({ id: "1", role: "user", text: "do it" }),
		msg({ id: "2", role: "assistant", error: true, text: "Turn aborted.", retryText: "do it" }),
	];
	render(<Transcript messages={messages} streaming={false} onRetry={t => (retried = t)} />);
	fireEvent.click(screen.getByRole("button", { name: /retry/i }));
	expect(retried).toBe("do it");
});

test("an error row that is NOT the last message shows no Retry", () => {
	const messages: ChatMessage[] = [
		msg({ id: "1", role: "assistant", error: true, text: "boom", retryText: "x" }),
		msg({ id: "2", role: "assistant", text: "recovered" }),
	];
	render(<Transcript messages={messages} streaming={false} onRetry={() => {}} />);
	expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
});

test("renders the emptyState when there are no messages", () => {
	render(<Transcript messages={[]} streaming={false} emptyState={<div>nothing here</div>} />);
	expect(screen.getByText("nothing here")).toBeDefined();
});

test("scroll-to-bottom FAB appears when scrolled up and hides after a click to the bottom", () => {
	const messages: ChatMessage[] = [msg({ id: "1", role: "assistant", text: "a" })];
	const { container } = render(<Transcript messages={messages} streaming={false} />);
	const list = container.querySelector(".messages") as HTMLElement;

	// happy-dom does no layout, so fake a scrolled-up viewport via getters.
	let top = 0;
	Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
	Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 200 });
	Object.defineProperty(list, "scrollTop", {
		configurable: true,
		get: () => top,
		set: v => {
			top = v;
		},
	});
	fireEvent.scroll(list);

	const fab = screen.getByRole("button", { name: /scroll to bottom/i });
	expect(fab).toBeDefined();

	fireEvent.click(fab);
	expect(list.scrollTop).toBe(1000);
	expect(screen.queryByRole("button", { name: /scroll to bottom/i })).toBeNull();
});

test("thinkingLabel annotates the pre-first-token row (so a slow turn doesn't read as a hang)", () => {
	const msgs: ChatMessage[] = [{ id: "a1", role: "assistant", text: "" }];
	const { container } = render(<Transcript messages={msgs} streaming={true} thinkingLabel="with web search" />);
	expect(within(container).getByText(/Thinking….*with web search/)).toBeDefined();
});

test("without thinkingLabel the row is the plain Thinking… indicator", () => {
	const msgs: ChatMessage[] = [{ id: "a1", role: "assistant", text: "" }];
	const { container } = render(<Transcript messages={msgs} streaming={true} />);
	expect(within(container).getByText(/Thinking…/)).toBeDefined();
	expect(container.textContent).not.toContain("with web search");
});

// ── Claude-parity: the brand block lives INSIDE the scrollport ───────────────
// Claude for Office scrolls its brand away with the transcript. Routing it through
// `emptyState` would make it VANISH on first send (EmptyState unmounts) instead of
// scrolling, so it must be a leading child of `.messages` in BOTH states.

test("brand renders inside the .messages scrollport when the transcript is empty", () => {
	const { container } = render(
		<Transcript messages={[]} streaming={false} brand={<div className="brand-block">xcsh</div>} />,
	);
	const scrollport = container.querySelector(".messages");
	const brand = container.querySelector(".brand-block");
	expect(brand).not.toBeNull();
	expect(scrollport?.contains(brand as Node)).toBe(true);
});

test("brand is the FIRST child of .messages and precedes the rows once messages exist", () => {
	const messages: ChatMessage[] = [msg({ id: "1", role: "user", text: "hello there" })];
	const { container } = render(
		<Transcript messages={messages} streaming={false} brand={<div className="brand-block">xcsh</div>} />,
	);
	const scrollport = container.querySelector(".messages") as HTMLElement;
	expect(scrollport.firstElementChild?.className).toContain("brand-block");
	// Still renders the row (brand does not replace content).
	expect(screen.getByText("hello there")).toBeDefined();
});

test("without brand nothing extra is rendered (other surfaces unaffected)", () => {
	const { container } = render(<Transcript messages={[]} streaming={false} />);
	expect(container.querySelector(".brand-block")).toBeNull();
});

test("an EMPTY transcript is not auto-pinned to the bottom (the brand stays visible)", () => {
	// The auto-pin useLayoutEffect has no dep array and userAtBottom starts true, so
	// without an `empty` guard it pins on first paint and scrolls the brand out of view.
	const { container } = render(
		<Transcript messages={[]} streaming={false} brand={<div className="brand-block">xcsh</div>} />,
	);
	const list = container.querySelector(".messages") as HTMLElement;
	Object.defineProperty(list, "scrollHeight", { configurable: true, value: 1000 });
	Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 });
	list.scrollTop = 0;
	// Force another render pass; the effect must NOT pin while empty.
	fireEvent.scroll(list);
	expect(list.scrollTop).toBe(0);
});
