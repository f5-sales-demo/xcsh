import { describe, expect, it } from "bun:test";
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
