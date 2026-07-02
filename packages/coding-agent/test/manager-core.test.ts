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
	for (const r of recs) m.set(r.tenantKey, r);
	return m;
}
const W = (tenantKey: string, port: number, lastSeen = 0): WorkerRec => ({ tenantKey, port, pid: 1, lastSeen });

describe("parseControlMsg", () => {
	test("valid provision/release/status", () => {
		expect(parseControlMsg({ type: "provision", tenantKey: "a|staging" })).toEqual({
			type: "provision",
			tenantKey: "a|staging",
		});
		expect(parseControlMsg({ type: "release", tenantKey: "a|staging" })).toEqual({
			type: "release",
			tenantKey: "a|staging",
		});
		expect(parseControlMsg({ type: "status" })).toEqual({ type: "status" });
	});
	test("rejects junk / missing fields / bad tenantKey", () => {
		expect(parseControlMsg({ type: "provision" })).toBeNull();
		expect(parseControlMsg({ type: "nope", tenantKey: "a|staging" })).toBeNull();
		expect(parseControlMsg({ type: "provision", tenantKey: "no-pipe" })).toBeNull();
		expect(parseControlMsg(null)).toBeNull();
	});
});

describe("needsProvision (idempotent)", () => {
	test("true when no live worker, false when one exists", () => {
		expect(needsProvision(reg(), "a|staging")).toBe(true);
		expect(needsProvision(reg(W("a|staging", 19222)), "a|staging")).toBe(false);
	});
});

describe("pickPort", () => {
	test("lowest free port in range", () => {
		expect(pickPort(reg(W("a|staging", 19222)), [19222, 19223, 19224])).toBe(19223);
	});
	test("null when exhausted", () => {
		expect(pickPort(reg(W("a", 19222), W("b", 19223)), [19222, 19223])).toBeNull();
	});
});

describe("staleKeys", () => {
	test("returns keys idle beyond ttl", () => {
		const now = 100_000;
		expect(staleKeys(reg(W("a", 19222, now - 40_000), W("b", 19223, now - 5_000)), now, 30_000)).toEqual(["a"]);
	});
});
