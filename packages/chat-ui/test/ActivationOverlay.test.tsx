import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActivationOverlay } from "../src/components/ActivationOverlay";
import type { ActivationGate } from "../src/types";

const GATES: ActivationGate[] = [
	{ name: "bridge", label: "bridge connected", status: "passed", ms: 120 },
	{ name: "worker", label: "starting worker…", status: "active", startedAt: Date.now() },
	{ name: "context", label: "reading this page", status: "pending" },
];

test("renders each gate's label and settled ms", () => {
	render(<ActivationOverlay gates={GATES} />);
	expect(screen.getByText("bridge connected")).toBeDefined();
	expect(screen.getByText("starting worker…")).toBeDefined();
	expect(screen.getByText("120 ms")).toBeDefined();
});

test("shows a Retry button only when blocked, and it fires onRetry", () => {
	let retried = false;
	const { rerender } = render(<ActivationOverlay gates={GATES} onRetry={() => (retried = true)} />);
	expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
	rerender(<ActivationOverlay gates={GATES} blocked onRetry={() => (retried = true)} />);
	fireEvent.click(screen.getByRole("button", { name: /retry/i }));
	expect(retried).toBe(true);
});
