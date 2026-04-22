import { describe, expect, it } from "bun:test";
import { ChordDispatcher } from "@f5xc-salesdemos/pi-tui/chord-dispatcher";

describe("ChordDispatcher — single-stroke dispatch", () => {
	it("dispatches a single-stroke binding", () => {
		const d = new ChordDispatcher([{ action: "app.exit", sequence: ["ctrl+c"] }], 1000);
		expect(d.feedKey("ctrl+c")).toEqual({
			kind: "dispatched",
			action: "app.exit",
		});
		d.dispose();
	});

	it("returns passthrough when no binding matches", () => {
		const d = new ChordDispatcher([{ action: "app.exit", sequence: ["ctrl+c"] }], 1000);
		expect(d.feedKey("a")).toEqual({ kind: "passthrough" });
		d.dispose();
	});
});

describe("ChordDispatcher — pending + chord dispatch", () => {
	it("sets pending on leader keystroke and dispatches on matching follow-up", () => {
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 1000);
		expect(d.feedKey("ctrl+x")).toEqual({ kind: "pending", leader: "ctrl+x" });
		expect(d.feedKey("b")).toEqual({
			kind: "dispatched",
			action: "app.sidebar.toggle",
		});
		d.dispose();
	});

	it("invokes onPending callback on leader", () => {
		let pendingLeader: string | null = null;
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 1000, {
			onPending: leader => {
				pendingLeader = leader;
			},
		});
		d.feedKey("ctrl+x");
		expect(pendingLeader).toBe("ctrl+x");
		d.dispose();
	});
});
