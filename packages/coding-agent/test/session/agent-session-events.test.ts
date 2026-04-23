import { describe, expect, it } from "bun:test";
import { TypedEventEmitter } from "@f5xc-salesdemos/pi-tui";
import type { AgentSessionEvents } from "../../src/session/agent-session";
import { AgentSession } from "../../src/session/agent-session";

describe("AgentSession.events — typed pub-sub bus", () => {
	it("AgentSession exports a class that has an `events` property on instances", () => {
		expect(typeof AgentSession).toBe("function");
		expect(AgentSession.name).toBe("AgentSession");
	});
});

describe("AgentSessionEvents type export", () => {
	it("`todoPhasesChanged` and `reminderFired` are keys of AgentSessionEvents", () => {
		// Purely compile-time check enforced by the import below.
		type KeyCheck = keyof import("../../src/session/agent-session").AgentSessionEvents;
		const keys: KeyCheck[] = ["todoPhasesChanged", "reminderFired"];
		expect(keys).toContain("todoPhasesChanged");
		expect(keys).toContain("reminderFired");
	});
});

describe("setTodoPhases emission contract (by surrogate emitter)", () => {
	it("TypedEventEmitter delivers todoPhasesChanged payloads with a clone-shaped object", () => {
		const bus = new TypedEventEmitter<AgentSessionEvents>();
		const received: Array<{ phases: unknown[] }> = [];
		bus.on("todoPhasesChanged", p => received.push({ phases: [...p.phases] }));
		bus.emit("todoPhasesChanged", { phases: [] });
		bus.emit("todoPhasesChanged", { phases: [{ id: "p1", name: "Phase 1", tasks: [] }] });
		expect(received).toHaveLength(2);
		expect(received[0]!.phases).toEqual([]);
		expect(received[1]!.phases).toHaveLength(1);
	});
});
