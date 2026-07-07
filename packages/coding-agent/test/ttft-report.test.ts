import { describe, expect, it } from "bun:test";
import { type BenchResult, compareToBaseline, median } from "../bench/ttft-report";

const base: BenchResult = {
	cold: {
		ttft_ms: 800,
		stages: { manager_provision: 2, worker_boot: 780, session_build: 900, chat_handler: 8, provider_ttft: 1 },
		runs: 5,
	},
	warm: {
		ttft_ms: 20,
		stages: { manager_provision: 2, worker_boot: 5, session_build: 40, chat_handler: 8, provider_ttft: 1 },
		runs: 5,
	},
};
const clone = (r: BenchResult): BenchResult => JSON.parse(JSON.stringify(r));

describe("median", () => {
	it("returns the middle of odd- and even-length sets", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});
});

describe("compareToBaseline", () => {
	it("no regression when current equals baseline", () => {
		expect(compareToBaseline(base, clone(base), 15)).toEqual([]);
	});
	it("no regression when faster", () => {
		const cur = clone(base);
		cur.cold.stages.worker_boot = 600;
		cur.cold.ttft_ms = 620;
		expect(compareToBaseline(base, cur, 15)).toEqual([]);
	});
	it("flags a stage that regressed beyond tolerance, naming the culprit", () => {
		const cur = clone(base);
		cur.cold.stages.worker_boot = 780 * 1.2; // +20% > 15%
		const regs = compareToBaseline(base, cur, 15);
		expect(regs.map(r => r.metric)).toContain("cold.worker_boot");
		expect(regs.find(r => r.metric === "cold.worker_boot")!.deltaPct).toBeGreaterThan(15);
	});
	it("flags a session_build regression (the createAgentSession/plugin-init seam)", () => {
		const cur = clone(base);
		cur.cold.stages.session_build = 900 * 1.3; // +30% > 15% and +270ms > floor
		const regs = compareToBaseline(base, cur, 15);
		expect(regs.map(r => r.metric)).toContain("cold.session_build");
	});
	it("does not flag exactly at the tolerance boundary", () => {
		const cur = clone(base);
		cur.warm.ttft_ms = 20 * 1.15; // exactly +15%
		expect(compareToBaseline(base, cur, 15)).toEqual([]);
	});
	it("does not flag a near-zero stage that grows by a large percent but a tiny absolute", () => {
		const cur = clone(base);
		cur.cold.stages.provider_ttft = 2; // 1 → 2ms = +100% but only +1ms absolute
		cur.warm.stages.manager_provision = 5; // 2 → 5ms = +150% but +3ms (not > 3)
		expect(compareToBaseline(base, cur, 15)).toEqual([]);
	});

	it("flags a near-zero stage only when the absolute jump also exceeds the floor", () => {
		const cur = clone(base);
		cur.cold.stages.provider_ttft = 10; // 1 → 10ms = +900% and +9ms > 3
		const regs = compareToBaseline(base, cur, 15);
		expect(regs.map(r => r.metric)).toEqual(["cold.provider_ttft"]);
	});

	it("handles a zero baseline: below the abs floor is ignored, a real jump is flagged (Infinity deltaPct)", () => {
		const zero = clone(base);
		zero.cold.stages.manager_provision = 0;
		const small = clone(zero);
		small.cold.stages.manager_provision = 2; // +2ms ≤ 3 → ignored
		expect(compareToBaseline(zero, small, 15)).toEqual([]);
		const big = clone(zero);
		big.cold.stages.manager_provision = 50; // +50ms > 3, deltaPct Infinity
		const regs = compareToBaseline(zero, big, 15);
		expect(regs.map(r => r.metric)).toEqual(["cold.manager_provision"]);
		expect(regs[0].deltaPct).toBe(Infinity);
	});
});
