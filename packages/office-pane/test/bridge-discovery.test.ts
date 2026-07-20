import { describe, expect, it } from "bun:test";
import type { BridgeInfo } from "../src/core/transport/bridge-discovery";
import {
	PORT_RANGE_END,
	PORT_RANGE_START,
	pickBridge,
	portCandidates,
	WSS_RANGE_END,
	WSS_RANGE_START,
	wssPortCandidates,
} from "../src/core/transport/bridge-discovery";

// ---------------------------------------------------------------------------
// portCandidates() — legacy ws range (kept for internal ws consumers)
// ---------------------------------------------------------------------------

describe("portCandidates()", () => {
	it("returns exactly 20 ports from 19222 to 19241 inclusive", () => {
		const ports = portCandidates();
		expect(ports).toHaveLength(20);
		expect(ports[0]).toBe(19222);
		expect(ports[ports.length - 1]).toBe(19241);
		for (let i = 0; i < ports.length; i++) {
			expect(ports[i]).toBe(PORT_RANGE_START + i);
		}
	});

	it("exports PORT_RANGE_START=19222 and PORT_RANGE_END=19241", () => {
		expect(PORT_RANGE_START).toBe(19222);
		expect(PORT_RANGE_END).toBe(19241);
	});
});

// ---------------------------------------------------------------------------
// wssPortCandidates() — wss range the transport actually connects on
// ---------------------------------------------------------------------------

describe("wssPortCandidates()", () => {
	it("returns exactly 20 ports from 19322 to 19341 inclusive", () => {
		const ports = wssPortCandidates();
		expect(ports).toHaveLength(20);
		expect(ports[0]).toBe(19322);
		expect(ports[ports.length - 1]).toBe(19341);
		for (let i = 0; i < ports.length; i++) {
			expect(ports[i]).toBe(WSS_RANGE_START + i);
		}
	});

	it("exports WSS_RANGE_START=19322 and WSS_RANGE_END=19341", () => {
		expect(WSS_RANGE_START).toBe(19322);
		expect(WSS_RANGE_END).toBe(19341);
	});

	it("is the ws range shifted by the +100 offset (mirrors xcsh)", () => {
		expect(WSS_RANGE_START).toBe(PORT_RANGE_START + 100);
		expect(WSS_RANGE_END).toBe(PORT_RANGE_END + 100);
	});
});

// ---------------------------------------------------------------------------
// pickBridge()
// ---------------------------------------------------------------------------

describe("pickBridge()", () => {
	function makeBridge(overrides: Partial<BridgeInfo> = {}): BridgeInfo {
		return {
			port: 19222,
			tenant: null,
			env: null,
			sessionId: null,
			contextBound: false,
			lastSeen: Date.now(),
			...overrides,
		};
	}

	it("(1) returns undefined for empty list", () => {
		expect(pickBridge([])).toBeUndefined();
	});

	it("(2) returns the only bridge when list has one entry", () => {
		const b = makeBridge({ port: 19222 });
		expect(pickBridge([b])).toEqual(b);
	});

	it("(3) filters by tenant when opts.tenant is specified", () => {
		const a = makeBridge({ port: 19222, tenant: "example-corp" });
		const b = makeBridge({ port: 19223, tenant: "example-corp" });
		const result = pickBridge([a, b], { tenant: "example-corp" });
		expect(result?.port).toBe(19222);
	});

	it("(4) returns undefined when tenant filter matches nothing", () => {
		const a = makeBridge({ port: 19222, tenant: "example-corp" });
		expect(pickBridge([a], { tenant: "example-corp" })).toBeUndefined();
	});

	it("(5) prefers contextBound=true over false by default (even with older lastSeen)", () => {
		const unbound = makeBridge({ port: 19222, contextBound: false, lastSeen: 1000 });
		const bound = makeBridge({ port: 19223, contextBound: true, lastSeen: 500 });
		const result = pickBridge([unbound, bound]);
		expect(result?.port).toBe(19223);
	});

	it("(6) does not prefer contextBound when preferContextBound: false", () => {
		const unbound = makeBridge({ port: 19222, contextBound: false, lastSeen: 1000 });
		const bound = makeBridge({ port: 19223, contextBound: true, lastSeen: 500 });
		const result = pickBridge([unbound, bound], { preferContextBound: false });
		expect(result?.port).toBe(19222); // higher lastSeen wins
	});

	it("(7) among equal contextBound, prefers most recently seen", () => {
		const older = makeBridge({ port: 19222, contextBound: true, lastSeen: 100 });
		const newer = makeBridge({ port: 19223, contextBound: true, lastSeen: 999 });
		const result = pickBridge([older, newer]);
		expect(result?.port).toBe(19223);
	});

	it("(8) respects tenant filter and contextBound preference together", () => {
		const a = makeBridge({ port: 19222, tenant: "example-corp", contextBound: false, lastSeen: 999 });
		const b = makeBridge({ port: 19223, tenant: "example-corp", contextBound: true, lastSeen: 1 });
		const c = makeBridge({ port: 19224, tenant: "example-corp", contextBound: true, lastSeen: 9999 });
		const result = pickBridge([a, b, c], { tenant: "example-corp" });
		expect(result?.port).toBe(19223); // b: tenant=x + contextBound=true; c excluded
	});

	it("(9) null tenant filter includes bridges with null tenant", () => {
		const nullTenant = makeBridge({ port: 19222, tenant: null });
		const named = makeBridge({ port: 19223, tenant: "example-corp" });
		const result = pickBridge([nullTenant, named], { tenant: null });
		expect(result?.port).toBe(19222);
	});
});
