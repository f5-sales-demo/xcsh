import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextChip } from "../src/components/ContextChip";

test("shows the host-supplied label", () => {
	render(<ContextChip label="Slide 1 selected" onDismiss={() => {}} />);
	expect(screen.getByText("Slide 1 selected")).toBeDefined();
});

test("the dismiss button fires onDismiss", () => {
	let dismissed = false;
	render(<ContextChip label="app.tsx" onDismiss={() => (dismissed = true)} />);
	fireEvent.click(screen.getByRole("button", { name: /dismiss context/i }));
	expect(dismissed).toBe(true);
});

test("the refresh button appears only when onRefresh is provided and fires it", () => {
	let refreshed = false;
	const { rerender } = render(<ContextChip label="x" onDismiss={() => {}} />);
	expect(screen.queryByRole("button", { name: /refresh context/i })).toBeNull();
	rerender(<ContextChip label="x" onDismiss={() => {}} onRefresh={() => (refreshed = true)} />);
	fireEvent.click(screen.getByRole("button", { name: /refresh context/i }));
	expect(refreshed).toBe(true);
});

test("reflects the connection state on the dot", () => {
	const { container, rerender } = render(<ContextChip label="x" onDismiss={() => {}} connected />);
	expect(container.querySelector(".dot.on")).not.toBeNull();
	rerender(<ContextChip label="x" onDismiss={() => {}} connected={false} />);
	expect(container.querySelector(".dot.on")).toBeNull();
});
