import { describe, expect, it } from "bun:test";
import { ChordDispatcher } from "@f5-sales-demo/pi-tui/chord-dispatcher";

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
		const pendingLeaders: string[] = [];
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 1000, {
			onPending: leader => {
				pendingLeaders.push(leader);
			},
		});
		d.feedKey("ctrl+x");
		expect(pendingLeaders).toEqual(["ctrl+x"]);
		d.dispose();
	});
});

describe("ChordDispatcher — abandoned path", () => {
	it("returns abandoned when 2nd stroke does not match any chord", () => {
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 1000);
		d.feedKey("ctrl+x");
		expect(d.feedKey("q")).toEqual({ kind: "abandoned" });
		d.dispose();
	});

	it("fires onCleared when pending is abandoned by non-match", () => {
		let cleared = 0;
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 1000, {
			onCleared: () => {
				cleared += 1;
			},
		});
		d.feedKey("ctrl+x");
		d.feedKey("q");
		expect(cleared).toBe(1);
		d.dispose();
	});

	it("fresh keystroke after abandoned is evaluated from unset state", () => {
		const d = new ChordDispatcher(
			[
				{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] },
				{ action: "app.exit", sequence: ["ctrl+c"] },
			],
			1000,
		);
		d.feedKey("ctrl+x");
		expect(d.feedKey("q")).toEqual({ kind: "abandoned" });
		expect(d.feedKey("ctrl+c")).toEqual({
			kind: "dispatched",
			action: "app.exit",
		});
		d.dispose();
	});
});

describe("ChordDispatcher — timeout", () => {
	it("clears pending after timeoutMs and fires onCleared", async () => {
		let cleared = 0;
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 20, {
			onCleared: () => {
				cleared += 1;
			},
		});
		d.feedKey("ctrl+x");
		await new Promise(r => setTimeout(r, 50));
		expect(cleared).toBe(1);
		expect(d.feedKey("ctrl+x")).toEqual({ kind: "pending", leader: "ctrl+x" });
		d.dispose();
	});
});

describe("ChordDispatcher — dispose", () => {
	it("clears pending, kills the timer, and does NOT invoke onCleared", async () => {
		let cleared = 0;
		const d = new ChordDispatcher([{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] }], 20, {
			onCleared: () => {
				cleared += 1;
			},
		});
		d.feedKey("ctrl+x");
		d.dispose();
		await new Promise(r => setTimeout(r, 50));
		expect(cleared).toBe(0);
	});
});
