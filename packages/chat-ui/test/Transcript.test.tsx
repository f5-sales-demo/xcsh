import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
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
