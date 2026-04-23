import { describe, expect, it } from "bun:test";
import { TypedEventEmitter } from "@f5xc-salesdemos/pi-tui";
import type { AgentSessionEvents } from "../../../src/session/agent-session";

// Validates the emission contract at the typed-bus level. Full event-controller
// wire-up is indirectly exercised by Task 10's baseline test and the final
// integration runs.

describe("reminderFired emission contract", () => {
	it("subscribers receive todos + attempt + maxAttempts", () => {
		const bus = new TypedEventEmitter<AgentSessionEvents>();
		const received: Array<{ todos: unknown[]; attempt: number; maxAttempts: number }> = [];
		bus.on("reminderFired", p => received.push(p));
		bus.emit("reminderFired", {
			todos: [{ id: "t1", content: "x", status: "pending" }],
			attempt: 1,
			maxAttempts: 3,
		});
		expect(received).toHaveLength(1);
		expect(received[0]!.attempt).toBe(1);
		expect(received[0]!.maxAttempts).toBe(3);
		expect(received[0]!.todos).toHaveLength(1);
	});
});
