import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ModeToggle } from "../src/components/ModeToggle";
import type { InteractionMode } from "../src/types";

const MODES: InteractionMode[] = [
	{ id: "educational", label: "Educational", blurb: "explain concepts" },
	{ id: "presentation", label: "Presentation", blurb: "guided demo" },
];

test("shows the current mode label", () => {
	render(<ModeToggle modes={MODES} mode="presentation" onChange={() => {}} />);
	expect(screen.getByRole("button", { name: /Presentation/ })).toBeDefined();
});

test("opens and selecting a mode fires onChange with its id", () => {
	let picked = "";
	render(<ModeToggle modes={MODES} mode="educational" onChange={m => (picked = m)} />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /Educational/ }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /Presentation/ }));
	expect(picked).toBe("presentation");
});
