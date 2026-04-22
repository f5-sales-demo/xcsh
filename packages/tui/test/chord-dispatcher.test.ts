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
