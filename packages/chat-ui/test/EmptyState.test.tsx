import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "../src/components/EmptyState";
import type { SkillPill } from "../src/types";

const PILLS: SkillPill[] = [
	{ id: "waap", label: "WAAP full stack", hint: "build a WAAP demo" },
	{ id: "lb", label: "Load balancer" },
];

test("renders the heading and skill pills, and picking a pill fires onPick with its id", () => {
	let picked = "";
	render(<EmptyState pills={PILLS} onPick={id => (picked = id)} />);
	expect(screen.getByText("Get started with these skills:")).toBeDefined();
	fireEvent.click(screen.getByRole("button", { name: /WAAP full stack/ }));
	expect(picked).toBe("waap");
});

test("renders the default F5 ascii logo", () => {
	render(<EmptyState pills={[]} onPick={() => {}} />);
	expect(screen.getByRole("img", { name: /f5 logo/i })).toBeDefined();
});

test("hides the heading when there are no pills", () => {
	render(<EmptyState pills={[]} onPick={() => {}} />);
	expect(screen.queryByText("Get started with these skills:")).toBeNull();
});

test("renders NO logo (and no empty wrapper) when logo={false}", () => {
	const { container } = render(<EmptyState pills={PILLS} onPick={() => {}} logo={false} />);
	// No F5 logo, and the .empty-logo wrapper is absent (no gap).
	expect(screen.queryByRole("img", { name: /f5 logo/i })).toBeNull();
	expect(container.querySelector(".empty-logo")).toBeNull();
	// Pills + heading still render.
	expect(screen.getByText("Get started with these skills:")).toBeDefined();
});
