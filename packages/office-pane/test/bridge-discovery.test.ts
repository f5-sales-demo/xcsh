import { describe, expect, it } from "bun:test";
import type { BridgeInfo } from "../src/core/transport/bridge-discovery";
import {
	OFFICE_WSS_RANGE_END,
	OFFICE_WSS_RANGE_START,
	officeWssPortCandidates,
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
// officeWssPortCandidates() — the DEDICATED office serve wss range (issue #2201)
// ---------------------------------------------------------------------------

describe("officeWssPortCandidates()", () => {
	it("returns exactly 20 ports from 19342 to 19361 inclusive", () => {
		const ports = officeWssPortCandidates();
		expect(ports).toHaveLength(20);
		expect(ports[0]).toBe(19342);
		expect(ports[ports.length - 1]).toBe(19361);
		for (let i = 0; i < ports.length; i++) {
			expect(ports[i]).toBe(OFFICE_WSS_RANGE_START + i);
		}
	});

	it("exports OFFICE_WSS_RANGE_START=19342 and OFFICE_WSS_RANGE_END=19361", () => {
		expect(OFFICE_WSS_RANGE_START).toBe(19342);
		expect(OFFICE_WSS_RANGE_END).toBe(19361);
	});

	it("is DISJOINT from the chrome wss range (no port overlap)", () => {
		// The structural-elimination core: an office bridge can NEVER answer on a chrome
		// port and vice-versa, so a mismatched pair simply finds nothing (never adopts).
		expect(OFFICE_WSS_RANGE_START).toBeGreaterThan(WSS_RANGE_END);
		const chrome = new Set(wssPortCandidates());
		for (const p of officeWssPortCandidates()) expect(chrome.has(p)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// pickBridge()
// ---------------------------------------------------------------------------

describe("pickBridge()", () => {
	function makeBridge(overrides: Partial<BridgeInfo> = {}): BridgeInfo {
		return {
			port: 19342,
			tenant: null,
			env: null,
			sessionId: null,
			contextBound: false,
			serveKind: "office",
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
		const a = makeBridge({ port: 19222, tenant: "acme" });
		const b = makeBridge({ port: 19223, tenant: "other" });
		const result = pickBridge([a, b], { tenant: "acme" });
		expect(result?.port).toBe(19222);
	});

	it("(4) returns undefined when tenant filter matches nothing", () => {
		const a = makeBridge({ port: 19222, tenant: "acme" });
		expect(pickBridge([a], { tenant: "nobody" })).toBeUndefined();
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
		const a = makeBridge({ port: 19222, tenant: "x", contextBound: false, lastSeen: 999 });
		const b = makeBridge({ port: 19223, tenant: "x", contextBound: true, lastSeen: 1 });
		const c = makeBridge({ port: 19224, tenant: "y", contextBound: true, lastSeen: 9999 });
		const result = pickBridge([a, b, c], { tenant: "x" });
		expect(result?.port).toBe(19223); // b: tenant=x + contextBound=true; c excluded
	});

	it("(9) null tenant filter includes bridges with null tenant", () => {
		const nullTenant = makeBridge({ port: 19222, tenant: null });
		const named = makeBridge({ port: 19223, tenant: "foo" });
		const result = pickBridge([nullTenant, named], { tenant: null });
		expect(result?.port).toBe(19222);
	});

	// --- requireServeKind filter (issue #2201 port-collision correctness core) ---

	it("(10) requireServeKind:'office' rejects a browser-kind bridge (even with matching tenant)", () => {
		const browser = makeBridge({ port: 19342, serveKind: "browser", tenant: "acme" });
		expect(pickBridge([browser], { requireServeKind: "office", tenant: "acme" })).toBeUndefined();
	});

	it("(11) requireServeKind:'office' rejects a serveKind:null bridge (stale/legacy → fail-safe)", () => {
		const legacy = makeBridge({ port: 19342, serveKind: null });
		expect(pickBridge([legacy], { requireServeKind: "office" })).toBeUndefined();
	});

	it("(12) requireServeKind:'office' accepts an office-kind bridge", () => {
		const office = makeBridge({ port: 19342, serveKind: "office" });
		expect(pickBridge([office], { requireServeKind: "office" })?.port).toBe(19342);
	});

	it("(13) among mixed candidates, requireServeKind adopts ONLY the office one", () => {
		const browser = makeBridge({ port: 19343, serveKind: "browser", contextBound: true, lastSeen: 9999 });
		const legacy = makeBridge({ port: 19344, serveKind: null, contextBound: true, lastSeen: 9998 });
		const office = makeBridge({ port: 19345, serveKind: "office", contextBound: false, lastSeen: 1 });
		// The browser bridge is contextBound + most-recent — it would win WITHOUT the filter.
		const result = pickBridge([browser, legacy, office], { requireServeKind: "office" });
		expect(result?.port).toBe(19345);
	});

	it("(14) no requireServeKind → serveKind is ignored (back-compat with the unfiltered call)", () => {
		const browser = makeBridge({ port: 19222, serveKind: "browser" });
		expect(pickBridge([browser])?.port).toBe(19222);
	});
});
