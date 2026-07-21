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
