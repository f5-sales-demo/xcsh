import { describe, expect, it } from "bun:test";
import { SessionManager } from "@f5xc-salesdemos/xcsh/session/session-manager";

describe("SessionManager.appendProfileChange", () => {
	it("writes a profile_change entry with the given fields", () => {
		const session = SessionManager.inMemory();

		const id = session.appendProfileChange("prod", "acme-corp", "production");

		const entries = session.getEntries();
		const entry = entries.find(e => e.type === "profile_change");
		expect(entry).toBeDefined();
		expect(entry).toMatchObject({
			type: "profile_change",
			profileName: "prod",
			tenant: "acme-corp",
			namespace: "production",
			id,
		});
		expect(typeof (entry as { timestamp: string }).timestamp).toBe("string");
	});

	it("returns a non-empty entry id", () => {
		const session = SessionManager.inMemory();
		const id = session.appendProfileChange("prod", "acme-corp", "default");
		expect(id.length).toBeGreaterThan(0);
	});
});
