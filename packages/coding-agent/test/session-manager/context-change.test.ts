import { describe, expect, it } from "bun:test";
import { SessionManager } from "@f5-sales-demo/xcsh/session/session-manager";

describe("SessionManager.appendContextChange", () => {
	it("writes a context_change entry with the given fields", () => {
		const session = SessionManager.inMemory();

		const id = session.appendContextChange("prod", "acme-corp", "production");

		const entries = session.getEntries();
		const entry = entries.find(e => e.type === "context_change");
		expect(entry).toBeDefined();
		expect(entry).toMatchObject({
			type: "context_change",
			contextName: "prod",
			tenant: "acme-corp",
			namespace: "production",
			id,
		});
		expect(typeof (entry as { timestamp: string }).timestamp).toBe("string");
	});

	it("returns a non-empty entry id", () => {
		const session = SessionManager.inMemory();
		const id = session.appendContextChange("prod", "acme-corp", "default");
		expect(id.length).toBeGreaterThan(0);
	});
});
