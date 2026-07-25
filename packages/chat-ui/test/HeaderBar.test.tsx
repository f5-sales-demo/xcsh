import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HeaderBar } from "../src/components/HeaderBar";
import type { MenuItem } from "../src/types";

const HISTORY: MenuItem[] = [
	{ id: "c1", label: "Yesterday's chat" },
	{ id: "c2", label: "Load balancer walkthrough" },
];
const MORE: MenuItem[] = [{ id: "settings", label: "Settings" }];

test("the new-chat button fires onNewChat", () => {
	let created = false;
	render(<HeaderBar onNewChat={() => (created = true)} />);
	fireEvent.click(screen.getByRole("button", { name: /new chat/i }));
	expect(created).toBe(true);
});

test("the history menu opens and an item fires onHistorySelect", () => {
	let picked = "";
	render(<HeaderBar onNewChat={() => {}} historyItems={HISTORY} onHistorySelect={id => (picked = id)} />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /chat history/i }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /load balancer walkthrough/i }));
	expect(picked).toBe("c2");
});

test("the more-options menu opens and an item fires onMoreSelect", () => {
	let picked = "";
	render(<HeaderBar onNewChat={() => {}} moreItems={MORE} onMoreSelect={id => (picked = id)} />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /more options/i }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));
	expect(picked).toBe("settings");
});

test("menus are not rendered when their item lists are omitted", () => {
	render(<HeaderBar onNewChat={() => {}} />);
	expect(screen.queryByRole("button", { name: /chat history/i })).toBeNull();
	expect(screen.queryByRole("button", { name: /more options/i })).toBeNull();
});

test("the history menu can caption its scope (session-only history must not look durable)", () => {
	render(<HeaderBar onNewChat={() => {}} historyItems={HISTORY} historyHeader="This session" />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /chat history/i }));
	});
	expect(screen.getByText("This session")).toBeDefined();
	// A caption, not a selectable entry.
	expect(screen.queryByRole("menuitem", { name: /this session/i })).toBeNull();
	expect(screen.getByRole("menuitem", { name: /load balancer walkthrough/i })).toBeDefined();
});

test("new chat is disabled when canNewChat is false, and enabled by default", () => {
	let created = 0;
	const { rerender } = render(<HeaderBar onNewChat={() => (created += 1)} canNewChat={false} />);
	const btn = () => screen.getByRole("button", { name: /new chat/i }) as HTMLButtonElement;
	expect(btn().disabled).toBe(true);
	fireEvent.click(btn());
	expect(created).toBe(0);

	// Omitted → enabled (the other surfaces pass no gate).
	rerender(<HeaderBar onNewChat={() => (created += 1)} />);
	expect(btn().disabled).toBe(false);
	fireEvent.click(btn());
	expect(created).toBe(1);
});

test("every control carries a data-tip tooltip matching its accessible name, and NO title", () => {
	const { container } = render(
		<HeaderBar onNewChat={() => {}} historyItems={HISTORY} moreItems={MORE} />,
	);
	const buttons = Array.from(container.querySelectorAll<HTMLElement>(".header-btn"));
	expect(buttons).toHaveLength(3);
	for (const btn of buttons) {
		const label = btn.getAttribute("aria-label");
		expect(label).toBeTruthy();
		// Our CSS tooltip is driven by data-tip. `title` must be ABSENT or the browser
		// renders a second, native tooltip on top of ours.
		expect(btn.getAttribute("data-tip")).toBe(label);
		expect(btn.getAttribute("title")).toBeNull();
	}
});

test("the controls are SVG icons (not text glyphs), hidden from the a11y tree", () => {
	const { container } = render(
		<HeaderBar onNewChat={() => {}} historyItems={HISTORY} moreItems={MORE} />,
	);
	const buttons = Array.from(container.querySelectorAll<HTMLElement>(".header-btn"));
	for (const btn of buttons) {
		const svg = btn.querySelector("svg");
		expect(svg).not.toBeNull();
		// The accessible name comes from aria-label; the glyph must not be announced.
		expect(svg?.getAttribute("aria-hidden")).toBe("true");
		// No leftover text glyph beside the icon.
		expect(btn.textContent?.trim()).toBe("");
	}
});

test("the controls read left-to-right: history, new chat, more", () => {
	const { container } = render(
		<HeaderBar onNewChat={() => {}} historyItems={HISTORY} moreItems={MORE} />,
	);
	const labels = Array.from(container.querySelectorAll<HTMLElement>(".header-btn")).map(b =>
		b.getAttribute("aria-label"),
	);
	expect(labels).toEqual(["Chat history", "New chat", "More options"]);
});
