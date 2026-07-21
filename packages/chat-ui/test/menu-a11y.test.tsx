import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ModelSelector } from "../src/components/ModelSelector";
import type { ModelOption } from "../src/types";

const MODELS: ModelOption[] = [
	{ id: "a", label: "model-a" },
	{ id: "b", label: "model-b" },
	{ id: "c", label: "model-c" },
];

// The shared useMenu behavior is exercised through ModelSelector; ModeToggle and
// HeaderBar use the same hook.
test("opening a menu moves focus to the first item and arrows/Home/End rove", () => {
	render(<ModelSelector models={MODELS} model="a" onSelect={() => {}} />);
	const trigger = screen.getByRole("button", { name: /model: model-a/i });
	act(() => {
		fireEvent.click(trigger);
	});
	const items = screen.getAllByRole("menuitem");
	expect(document.activeElement).toBe(items[0]);

	fireEvent.keyDown(items[0], { key: "ArrowDown" });
	expect(document.activeElement).toBe(items[1]);

	fireEvent.keyDown(items[1], { key: "ArrowUp" });
	expect(document.activeElement).toBe(items[0]);

	fireEvent.keyDown(items[0], { key: "End" });
	expect(document.activeElement).toBe(items[2]);

	fireEvent.keyDown(items[2], { key: "Home" });
	expect(document.activeElement).toBe(items[0]);
});

test("Escape closes the menu and returns focus to the trigger", () => {
	render(<ModelSelector models={MODELS} model="a" onSelect={() => {}} />);
	const trigger = screen.getByRole("button", { name: /model: model-a/i });
	act(() => {
		fireEvent.click(trigger);
	});
	expect(screen.queryByRole("menu")).not.toBeNull();

	act(() => {
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
	});
	expect(screen.queryByRole("menu")).toBeNull();
	expect(document.activeElement).toBe(trigger);
});
