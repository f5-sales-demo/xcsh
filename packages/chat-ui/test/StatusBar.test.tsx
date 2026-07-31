import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { COLORS } from "../src";
import { StatusBar } from "../src/components/StatusBar";

test("renders the rounded context percentage and the session label", () => {
	const { container } = render(<StatusBar contextPct={42.6} sessionLabel="example-corp·prod" />);
	expect(screen.getByText("43%")).toBeDefined();
	expect(screen.getByText("example-corp·prod")).toBeDefined();
	// The session segment is F5 red.
	const session = container.querySelector(".seg-session") as HTMLElement;
	expect(session.style.background).toContain(COLORS.f5Red);
});

test("omits the context segment when pct is null", () => {
	const { container } = render(<StatusBar contextPct={null} sessionLabel="x" />);
	expect(container.querySelector(".seg-context")).toBeNull();
});

test("clamps the gradient step for out-of-range values without throwing", () => {
	// The gradient is clamped to [0,100]; the numeric label reflects the raw value.
	const { container } = render(<StatusBar contextPct={999} sessionLabel="" />);
	expect(container.querySelector(".seg-context")).not.toBeNull();
	expect(screen.getByText("999%")).toBeDefined();
});
