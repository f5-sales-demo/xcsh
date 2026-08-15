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

/**
 * Give every div a non-zero `scrollHeight` for the duration of `body`.
 *
 * happy-dom has no layout engine, so `scrollHeight` is 0 and `scrollTop =
 * scrollHeight` is a no-op — an auto-pin assertion would pass whether or not the
 * component pins, which is worse than no test. Stubbing it on the PROTOTYPE (before
 * render, since the effect runs during the first commit) makes a pin observable.
 */
function withFakeScrollHeight(value: number, body: () => void): void {
	const proto = HTMLDivElement.prototype as unknown as object;
	const original = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
	Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => value });
	try {
		body();
	} finally {
		if (original) Object.defineProperty(proto, "scrollHeight", original);
		else Reflect.deleteProperty(proto, "scrollHeight");
	}
}

test("an EMPTY transcript is not auto-pinned to the bottom (the brand stays visible)", () => {
	// The auto-pin useLayoutEffect has no dep array and userAtBottom starts true, so
	// without an `empty` guard it pins on first paint and scrolls the brand out of view.
	withFakeScrollHeight(1000, () => {
		const { container } = render(
			<Transcript messages={[]} streaming={false} brand={<div className="brand-block">xcsh</div>} />,
		);
		expect((container.querySelector(".messages") as HTMLElement).scrollTop).toBe(0);
	});
});

test("a POPULATED transcript still auto-pins to the tail (the guard didn't disable following)", () => {
	withFakeScrollHeight(1000, () => {
		const messages: ChatMessage[] = [msg({ id: "1", role: "assistant", text: "streamed answer" })];
		const { container } = render(
			<Transcript messages={messages} streaming={true} brand={<div className="brand-block">xcsh</div>} />,
		);
		expect((container.querySelector(".messages") as HTMLElement).scrollTop).toBe(1000);
	});
});


test("renders native muted video and disables autoplay for reduced motion", () => {
	const original = window.matchMedia;
	window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
	try {
		const messages: ChatMessage[] = [
			msg({
				id: "media-1",
				role: "assistant",
				media: [
					{
						id: "media_a",
						kind: "video",
						src: "blob:video",
						posterSrc: "blob:poster",
						caption: "Demo clip",
						playback: { autoplay: true, loop: false, muted: true },
					},
				],
			}),
		];
		const { container } = render(<Transcript messages={messages} streaming={false} />);
		const video = container.querySelector("video") as HTMLVideoElement;
		expect(video).not.toBeNull();
		expect(video.autoplay).toBe(false);
		expect(video.muted).toBe(true);
		expect(screen.getByText("Demo clip")).toBeDefined();
	} finally {
		window.matchMedia = original;
	}
});

test("reduced motion keeps a text timeline on its first frame", async () => {
	const original = window.matchMedia;
	window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
	try {
		render(
			<Transcript
				messages={[
					msg({
						id: "media-2",
						role: "assistant",
						media: [
							{
								id: "media_b",
								kind: "text-timeline",
								frames: [
									{ text: "first", durationMs: 1 },
									{ text: "second", durationMs: 1 },
								],
								playback: { autoplay: true, loop: true, muted: true },
							},
						],
					}),
				]}
				streaming={false}
			/>,
		);
		await new Promise(resolve => setTimeout(resolve, 5));
		expect(screen.getByText("first")).toBeDefined();
		expect(screen.queryByText("second")).toBeNull();
	} finally {
		window.matchMedia = original;
	}
});
