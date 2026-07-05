import { describe, expect, it, test } from "bun:test";
import { sparesToSpawn } from "@f5-sales-demo/xcsh/commands/manager-core";
import {
	type ManagerState,
	needsProvision,
	parseControlMsg,
	parseManagerState,
	pickPort,
	type Registry,
	serializeManagerState,
	shouldSupersede,
	staleKeys,
	type WorkerRec,
} from "../src/commands/manager-core";

function reg(...recs: WorkerRec[]): Registry {
	const m: Registry = new Map();
	for (const r of recs) m.set(r.sessionId, r);
	return m;
}
const W = (sessionId: string, port: number, lastSeen = 0): WorkerRec => ({
	sessionId,
	tenant: "acme|production",
	port,
	pid: 1,
	lastSeen,
});

describe("parseControlMsg", () => {
	test("valid provision/release/status", () => {
		expect(parseControlMsg({ type: "provision", sessionId: "tab-7", tenant: "acme|staging" })).toEqual({
			type: "provision",
			sessionId: "tab-7",
			tenant: "acme|staging",
		});
		expect(parseControlMsg({ type: "release", sessionId: "tab-7" })).toEqual({ type: "release", sessionId: "tab-7" });
		expect(parseControlMsg({ type: "status" })).toEqual({ type: "status" });
	});
	test("rejects junk / missing fields / bad tenant", () => {
		expect(parseControlMsg({ type: "provision", sessionId: "tab-7" })).toBeNull(); // no tenant
		expect(parseControlMsg({ type: "provision", tenant: "acme|staging" })).toBeNull(); // no sessionId
		expect(parseControlMsg({ type: "provision", sessionId: "tab-7", tenant: "no-pipe" })).toBeNull();
		expect(parseControlMsg({ type: "release" })).toBeNull();
		expect(parseControlMsg({ type: "nope", sessionId: "tab-7" })).toBeNull();
		expect(parseControlMsg(null)).toBeNull();
	});
	// #1874 lifecycle frames.
	test("accepts hello and shutdown{reason}", () => {
		expect(parseControlMsg({ type: "hello" })).toEqual({ type: "hello" });
		expect(parseControlMsg({ type: "shutdown", reason: "superseded" })).toEqual({
			type: "shutdown",
			reason: "superseded",
		});
		expect(parseControlMsg({ type: "shutdown", reason: "updated" })).toEqual({ type: "shutdown", reason: "updated" });
		expect(parseControlMsg({ type: "shutdown", reason: "manual" })).toEqual({ type: "shutdown", reason: "manual" });
	});
	test("rejects shutdown with an unknown/missing reason (fail closed)", () => {
		expect(parseControlMsg({ type: "shutdown" })).toBeNull();
		expect(parseControlMsg({ type: "shutdown", reason: "hax" })).toBeNull();
		expect(parseControlMsg({ type: "shutdown", reason: 3 })).toBeNull();
	});
});

// #1874: version-aware supersede — a NEWER binary replaces an older running
// manager; equal/newer/malformed never supersede (fail closed, no flapping).
describe("shouldSupersede", () => {
	it("true only when ourVersion is strictly greater", () => {
		expect(shouldSupersede("19.56.2", "19.58.1")).toBe(true);
		expect(shouldSupersede("19.58.0", "19.58.1")).toBe(true);
		expect(shouldSupersede("18.99.99", "19.0.0")).toBe(true);
	});
	it("false on equal or newer running version", () => {
		expect(shouldSupersede("19.58.1", "19.58.1")).toBe(false);
		expect(shouldSupersede("19.58.2", "19.58.1")).toBe(false);
		expect(shouldSupersede("20.0.0", "19.58.1")).toBe(false);
	});
	it("false (fail closed) on null / malformed versions", () => {
		expect(shouldSupersede(null, "19.58.1")).toBe(false);
		expect(shouldSupersede("", "19.58.1")).toBe(false);
		expect(shouldSupersede("garbage", "19.58.1")).toBe(false);
		expect(shouldSupersede("19.58", "19.58.1")).toBe(false);
		expect(shouldSupersede("19.56.2", "notsemver")).toBe(false);
	});
});

describe("manager state file round-trip", () => {
	const s: ManagerState = {
		pid: 4242,
		version: "19.58.1",
		socket: "/home/u/.xcsh/manager.sock",
		startedAt: 1_700_000,
	};
	it("serialize → parse is identity", () => {
		expect(parseManagerState(serializeManagerState(s))).toEqual(s);
	});
	it("returns null on corrupt / missing / bad-shape input", () => {
		expect(parseManagerState("{not json")).toBeNull();
		expect(parseManagerState("{}")).toBeNull();
		expect(parseManagerState(JSON.stringify({ pid: -1, version: "1.0.0", socket: "/s", startedAt: 1 }))).toBeNull();
		expect(parseManagerState(JSON.stringify({ pid: 5, version: "", socket: "/s", startedAt: 1 }))).toBeNull();
		expect(parseManagerState(JSON.stringify({ pid: 5, version: "1.0.0", startedAt: 1 }))).toBeNull();
	});
});
describe("needsProvision (idempotent per sessionId)", () => {
	test("true when no live worker, false when one exists", () => {
		expect(needsProvision(reg(), "tab-7")).toBe(true);
		expect(needsProvision(reg(W("tab-7", 19222)), "tab-7")).toBe(false);
	});
	test("two same-tenant sids are independent", () => {
		const r = reg(W("tab-7", 19222));
		expect(needsProvision(r, "tab-8")).toBe(true); // same tenant, different tab → still needs its own worker
	});
});
describe("pickPort", () => {
	test("lowest free port", () => {
		expect(pickPort(reg(W("tab-7", 19222)), [19222, 19223, 19224])).toBe(19223);
	});
	test("null when exhausted", () => {
		expect(pickPort(reg(W("a", 19222), W("b", 19223)), [19222, 19223])).toBeNull();
	});
});
describe("staleKeys", () => {
	test("returns sids idle beyond ttl", () => {
		const now = 100_000;
		expect(staleKeys(reg(W("a", 19222, now - 40_000), W("b", 19223, now - 5_000)), now, 30_000)).toEqual(["a"]);
	});
});

describe("sparesToSpawn", () => {
	it("spawns up to target when ports are plentiful", () => {
		expect(sparesToSpawn(2, 0, 0, 20)).toBe(2);
		expect(sparesToSpawn(2, 1, 0, 20)).toBe(1);
		expect(sparesToSpawn(2, 2, 0, 20)).toBe(0);
	});
	it("never exceeds the port budget (spares + active <= totalPorts)", () => {
		expect(sparesToSpawn(2, 0, 19, 20)).toBe(1); // only 1 free slot
		expect(sparesToSpawn(2, 0, 20, 20)).toBe(0); // range full
		expect(sparesToSpawn(2, 1, 19, 20)).toBe(0); // 1 spare + 19 active = full
	});
	it("is never negative and treats target 0 as disabled", () => {
		expect(sparesToSpawn(0, 0, 0, 20)).toBe(0);
		expect(sparesToSpawn(2, 5, 0, 20)).toBe(0);
	});
});
