import { describe, expect, it } from "bun:test";
import { BRIDGE_PORT_BASE_DEFAULT, deriveBridgePorts, resolveBridgePortBase } from "../../src/browser/extension-bridge";

/**
 * The bridge port layout is a fixed global today, so every clone, worktree and live session on a
 * machine competes for the same 19222-19261 window — and `manager.int.test.ts` reaps whatever holds
 * its slice of it, including a developer's own bridge. Making the base overridable is what lets a
 * test claim a private window instead (#2495).
 */
describe("resolveBridgePortBase", () => {
	it("defaults to the historical base", () => {
		expect(resolveBridgePortBase({})).toBe(BRIDGE_PORT_BASE_DEFAULT);
		expect(BRIDGE_PORT_BASE_DEFAULT).toBe(19222);
	});

	it("honours XCSH_BRIDGE_PORT_START", () => {
		expect(resolveBridgePortBase({ XCSH_BRIDGE_PORT_START: "20500" })).toBe(20500);
	});

	it("ignores a value that is not a usable port", () => {
		for (const bad of ["", "not-a-number", "0", "-1", "70000", "19222.5"]) {
			expect(resolveBridgePortBase({ XCSH_BRIDGE_PORT_START: bad })).toBe(BRIDGE_PORT_BASE_DEFAULT);
		}
	});
});

describe("deriveBridgePorts", () => {
	// The default must reproduce the constants that shipped, or this refactor silently moves every
	// bridge on every machine.
	it("reproduces the historical layout at the default base", () => {
		const p = deriveBridgePorts(BRIDGE_PORT_BASE_DEFAULT);
		expect(p.chrome).toEqual({ start: 19222, end: 19241 });
		expect(p.office).toEqual({ start: 19242, end: 19261 });
		expect(p.wss).toEqual({ start: 19322, end: 19341 });
		expect(p.defaultPort).toBe(19222);
	});

	it("shifts every range coherently so the invariants survive", () => {
		const p = deriveBridgePorts(20500);
		expect(p.chrome).toEqual({ start: 20500, end: 20519 });
		// Office sits immediately above chrome, same width.
		expect(p.office).toEqual({ start: 20520, end: 20539 });
		// wss stays a fixed +100 from its ws port, so a pair can never desync.
		expect(p.wss).toEqual({ start: 20600, end: 20619 });
		expect(p.defaultPort).toBe(20500);
	});

	it("keeps chrome and office disjoint at any base", () => {
		for (const base of [19222, 20000, 20500, 30000]) {
			const p = deriveBridgePorts(base);
			expect(p.chrome.end).toBeLessThan(p.office.start);
			// The office wss pair must not land inside the chrome wss range either.
			expect(p.wss.end).toBeLessThan(p.office.start + 100);
		}
	});
});
