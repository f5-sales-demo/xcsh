import { describe, expect, it } from "bun:test";
import { mapContextStatus } from "@f5-sales-demo/xcsh/modes/components/welcome-checks";

describe("mapContextStatus", () => {
	it("no_context → unauthenticated with /context create hint", () => {
		const r = mapContextStatus({ state: "no_context" });
		expect(r.name).toBe("F5 XC Context");
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context create");
	});
	it("connected → connected", () => {
		const r = mapContextStatus({ state: "connected", name: "prod", latencyMs: 10 });
		expect(r.state).toBe("connected");
		expect(r.name).toBe("F5 XC Context");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with /context hint", () => {
		const r = mapContextStatus({ state: "auth_error", name: "prod" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context");
	});
	it("offline with network errorClass → hint mentions connectivity", () => {
		const r = mapContextStatus({ state: "offline", name: "prod", errorClass: "network" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("network");
	});
	it("offline with url_not_found errorClass → hint mentions URL", () => {
		const r = mapContextStatus({ state: "offline", name: "prod", errorClass: "url_not_found" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("URL");
	});
	it("offline without errorClass → generic /context hint", () => {
		const r = mapContextStatus({ state: "offline", name: "prod" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context");
	});
});
