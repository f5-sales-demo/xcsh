import { describe, expect, it, test } from "bun:test";
import { sparesToSpawn } from "@f5-sales-demo/xcsh/commands/manager-core";
import {
	needsProvision,
	parseControlMsg,
	pickPort,
	type Registry,
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
