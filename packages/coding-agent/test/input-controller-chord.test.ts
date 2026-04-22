import { describe, expect, it } from "bun:test";
import { routeChordResult } from "../src/modes/controllers/chord-routing";

describe("routeChordResult", () => {
	it("dispatched → calls action sink", () => {
		const actions: string[] = [];
		const editors: string[] = [];
		routeChordResult({ kind: "dispatched", action: "app.exit" }, "ctrl+c", {
			action: a => actions.push(a),
			editor: k => editors.push(k),
		});
		expect(actions).toEqual(["app.exit"]);
		expect(editors).toEqual([]);
	});

	it("passthrough → calls editor sink", () => {
		const actions: string[] = [];
		const editors: string[] = [];
		routeChordResult({ kind: "passthrough" }, "a", {
			action: a => actions.push(a),
			editor: k => editors.push(k),
		});
		expect(actions).toEqual([]);
		expect(editors).toEqual(["a"]);
	});

	it("pending → swallows (no action, no editor)", () => {
		const actions: string[] = [];
		const editors: string[] = [];
		routeChordResult({ kind: "pending", leader: "ctrl+x" }, "ctrl+x", {
			action: a => actions.push(a),
			editor: k => editors.push(k),
		});
		expect(actions).toEqual([]);
		expect(editors).toEqual([]);
	});

	it("abandoned → swallows (no action, no editor)", () => {
		const actions: string[] = [];
		const editors: string[] = [];
		routeChordResult({ kind: "abandoned" }, "q", {
			action: a => actions.push(a),
			editor: k => editors.push(k),
		});
		expect(actions).toEqual([]);
		expect(editors).toEqual([]);
	});
});
