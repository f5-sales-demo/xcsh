import { describe, expect, test } from "bun:test";
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
