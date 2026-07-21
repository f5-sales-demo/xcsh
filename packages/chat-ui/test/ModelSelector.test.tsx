import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ModelSelector } from "../src/components/ModelSelector";
import type { ModelOption } from "../src/types";

const MODELS: ModelOption[] = [
	{ id: "claude-opus-4-8", label: "claude-opus-4-8" },
	{ id: "claude-sonnet-5", label: "claude-sonnet-5" },
];

test("shows the current model label", () => {
	render(<ModelSelector models={MODELS} model="claude-opus-4-8" onSelect={() => {}} />);
	expect(screen.getByText("claude-opus-4-8")).toBeDefined();
});

test("opens the menu and selecting a model fires onSelect then closes", () => {
	let picked = "";
	render(<ModelSelector models={MODELS} model="claude-opus-4-8" onSelect={m => (picked = m)} />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /model: claude-opus-4-8/i }));
	});
	expect(screen.getByRole("menuitem", { name: /claude-sonnet-5/ })).toBeDefined();
	fireEvent.click(screen.getByRole("menuitem", { name: /claude-sonnet-5/ }));
	expect(picked).toBe("claude-sonnet-5");
	expect(screen.queryByRole("menu")).toBeNull();
});

test("does not open when disabled", () => {
	render(<ModelSelector models={MODELS} model="claude-opus-4-8" onSelect={() => {}} disabled />);
	fireEvent.click(screen.getByRole("button"));
	expect(screen.queryByRole("menu")).toBeNull();
});
