import { describe, expect, it } from "bun:test";
import { type BenchResult, compareToBaseline, median } from "../bench/ttft-report";

const base: BenchResult = {
	cold: {
		ttft_ms: 800,
		stages: { manager_provision: 2, worker_boot: 780, chat_handler: 8, provider_ttft: 1 },
		runs: 5,
	},
	warm: { ttft_ms: 20, stages: { manager_provision: 2, worker_boot: 5, chat_handler: 8, provider_ttft: 1 }, runs: 5 },
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
	it("does not flag exactly at the tolerance boundary", () => {
		const cur = clone(base);
		cur.warm.ttft_ms = 20 * 1.15; // exactly +15%
		expect(compareToBaseline(base, cur, 15)).toEqual([]);
	});
});
